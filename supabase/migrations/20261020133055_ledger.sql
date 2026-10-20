-- Ledger (SPEC §3.4, §3.5): stock_moves (append-only), stock_balances (maintained only by the
-- stock_moves AFTER INSERT trigger), activity_log (append-only), and the reset/test helpers.

create type public.move_type as enum (
  'grn', 'putaway', 'move', 'issue', 'return_to_stock', 'return_to_quarantine',
  'return_to_supplier', 'adjust_in', 'adjust_out', 'emergency_in'
);

create table public.stock_balances (
  workshop_id uuid not null,
  bin_id uuid not null,
  part_id uuid not null references public.parts (id) on delete restrict,
  on_hand int not null check (on_hand >= 0),
  created_at timestamptz not null default now(),
  primary key (bin_id, part_id),
  foreign key (workshop_id, bin_id) references public.bins (workshop_id, id) on delete restrict
);
create index stock_balances_workshop_part_idx on public.stock_balances (workshop_id, part_id);

create table public.stock_moves (
  id bigint generated always as identity primary key,
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  part_id uuid not null references public.parts (id) on delete restrict,
  move_type public.move_type not null,
  qty int not null check (qty > 0),
  from_bin_id uuid null,
  to_bin_id uuid null,
  job_card_line_id uuid null,
  grn_line_id uuid null,
  emergency_buy_id uuid null,
  reason text null,
  note text null,
  user_id uuid null,
  request_id uuid null,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (workshop_id, from_bin_id) references public.bins (workshop_id, id) on delete restrict,
  foreign key (workshop_id, to_bin_id) references public.bins (workshop_id, id) on delete restrict,
  foreign key (workshop_id, job_card_line_id) references public.job_card_lines (workshop_id, id),
  foreign key (workshop_id, grn_line_id) references public.grn_lines (workshop_id, id),
  foreign key (workshop_id, emergency_buy_id) references public.emergency_buys (workshop_id, id),
  check (from_bin_id is not null or to_bin_id is not null),
  check (from_bin_id is distinct from to_bin_id)
);
create index stock_moves_workshop_part_idx on public.stock_moves (workshop_id, part_id, id);
create index stock_moves_job_card_line_id_idx on public.stock_moves (job_card_line_id) where job_card_line_id is not null;
create index stock_moves_grn_line_id_idx on public.stock_moves (grn_line_id) where grn_line_id is not null;
create index stock_moves_emergency_buy_id_idx on public.stock_moves (emergency_buy_id) where emergency_buy_id is not null;
create index stock_moves_from_bin_idx on public.stock_moves (from_bin_id, part_id) where from_bin_id is not null;
create index stock_moves_to_bin_idx on public.stock_moves (to_bin_id, part_id) where to_bin_id is not null;

create table public.activity_log (
  id bigint generated always as identity primary key,
  workshop_id uuid null references public.workshops (id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  summary jsonb not null default '{}',
  user_id uuid null,
  request_id uuid null,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now()
);
create index activity_log_entity_idx on public.activity_log (entity_type, entity_id);
create index activity_log_workshop_idx on public.activity_log (workshop_id, id);

-- ---------------------------------------------------------------------------------------------
-- Append-only: UPDATE and DELETE raise for every role. Statement-level, so even an UPDATE that
-- matches no rows fails. TRUNCATE (reset_demo, test_clear) is not blocked.

create function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.err('VALIDATION', jsonb_build_object(
    'reason', 'append_only', 'table', tg_table_name, 'op', tg_op));
  return null;
end
$$;

create trigger stock_moves_append_only
before update or delete on public.stock_moves
for each statement execute function private.forbid_mutation();

create trigger activity_log_append_only
before update or delete on public.activity_log
for each statement execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------------------------
-- Move-type bin rules (SPEC §3.4), from -> to:
--   grn:                  none -> receiving (grn_line_id)
--   putaway:              receiving -> normal
--   move:                 normal|receiving -> normal; normal|receiving -> quarantine (reason);
--                         quarantine -> normal (reason; manager is checked by the RPC)
--   issue:                normal|receiving -> none (job_card_line_id)
--   return_to_stock:      none -> normal (job_card_line_id)
--   return_to_quarantine: none -> quarantine (job_card_line_id)
--   return_to_supplier:   quarantine -> none (reason)
--   adjust_in:            none -> any (reason)
--   adjust_out:           any -> none (reason)
--   emergency_in:         none -> receiving (emergency_buy_id)
-- The destination bin must be active (FOR SHARE so a concurrent deactivation waits), and the
-- part must match the linked line, GRN line or emergency buy.

create function private.stock_moves_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from public.bin_kind;
  v_to public.bin_kind;
  v_to_active boolean;
  v_has_reason boolean := nullif(btrim(coalesce(new.reason, '')), '') is not null;
  v_ok boolean;
  v_part uuid;
begin
  if new.from_bin_id is not null then
    select b.kind into v_from from public.bins b
    where b.id = new.from_bin_id and b.workshop_id = new.workshop_id;
    if not found then
      perform private.err('NOT_FOUND', jsonb_build_object('bin_id', new.from_bin_id));
    end if;
  end if;
  if new.to_bin_id is not null then
    select b.kind, b.is_active into v_to, v_to_active from public.bins b
    where b.id = new.to_bin_id and b.workshop_id = new.workshop_id
    for share;
    if not found then
      perform private.err('NOT_FOUND', jsonb_build_object('bin_id', new.to_bin_id));
    end if;
    if not v_to_active then
      perform private.err('VALIDATION', jsonb_build_object('reason', 'bin_inactive', 'bin_id', new.to_bin_id));
    end if;
  end if;

  v_ok := case new.move_type
    when 'grn' then v_from is null and v_to = 'receiving'
    when 'putaway' then v_from = 'receiving' and v_to = 'normal'
    when 'move' then
      (v_from in ('normal', 'receiving') and v_to in ('normal', 'quarantine'))
      or (v_from = 'quarantine' and v_to = 'normal')
    when 'issue' then v_from in ('normal', 'receiving') and v_to is null
    when 'return_to_stock' then v_from is null and v_to = 'normal'
    when 'return_to_quarantine' then v_from is null and v_to = 'quarantine'
    when 'return_to_supplier' then v_from = 'quarantine' and v_to is null
    when 'adjust_in' then v_from is null and v_to is not null
    when 'adjust_out' then v_from is not null and v_to is null
    when 'emergency_in' then v_from is null and v_to = 'receiving'
    else false
  end;
  if not coalesce(v_ok, false) then
    perform private.err('BIN_KIND_NOT_ALLOWED', jsonb_build_object(
      'move_type', new.move_type, 'from_kind', v_from, 'to_kind', v_to));
  end if;

  if not v_has_reason and (
    new.move_type in ('return_to_supplier', 'adjust_in', 'adjust_out')
    or (new.move_type = 'move' and (v_to = 'quarantine' or v_from = 'quarantine'))
  ) then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'reason_required', 'move_type', new.move_type));
  end if;

  if (new.move_type = 'grn' and new.grn_line_id is null)
     or (new.move_type in ('issue', 'return_to_stock', 'return_to_quarantine') and new.job_card_line_id is null)
     or (new.move_type = 'emergency_in' and new.emergency_buy_id is null) then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'link_required', 'move_type', new.move_type));
  end if;

  if new.job_card_line_id is not null then
    select l.part_id into v_part from public.job_card_lines l where l.id = new.job_card_line_id;
    if v_part is distinct from new.part_id then
      perform private.err('VALIDATION', jsonb_build_object('reason', 'part_mismatch', 'link', 'job_card_line'));
    end if;
  end if;
  if new.grn_line_id is not null then
    select g.part_id into v_part from public.grn_lines g where g.id = new.grn_line_id;
    if v_part is distinct from new.part_id then
      perform private.err('VALIDATION', jsonb_build_object('reason', 'part_mismatch', 'link', 'grn_line'));
    end if;
  end if;
  if new.emergency_buy_id is not null then
    select e.part_id into v_part from public.emergency_buys e where e.id = new.emergency_buy_id;
    if v_part is distinct from new.part_id then
      perform private.err('VALIDATION', jsonb_build_object('reason', 'part_mismatch', 'link', 'emergency_buy'));
    end if;
  end if;
  return new;
end
$$;

create trigger stock_moves_check
before insert on public.stock_moves
for each row execute function private.stock_moves_check();

-- The only writer of stock_balances (apart from the reset rebuild and TRUNCATE, SPEC §3.4).
create function private.stock_moves_apply()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.from_bin_id is not null then
    update public.stock_balances
    set on_hand = on_hand - new.qty
    where bin_id = new.from_bin_id and part_id = new.part_id and on_hand >= new.qty;
    if not found then
      perform private.err('INSUFFICIENT_BIN_STOCK', jsonb_build_object(
        'bin_id', new.from_bin_id, 'part_id', new.part_id, 'qty', new.qty));
    end if;
  end if;
  if new.to_bin_id is not null then
    insert into public.stock_balances (workshop_id, bin_id, part_id, on_hand)
    values (new.workshop_id, new.to_bin_id, new.part_id, new.qty)
    on conflict (bin_id, part_id) do update set on_hand = public.stock_balances.on_hand + excluded.on_hand;
  end if;
  return null;
end
$$;

create trigger stock_moves_apply
after insert on public.stock_moves
for each row execute function private.stock_moves_apply();

-- ---------------------------------------------------------------------------------------------
-- RLS (SPEC §11.3). activity_log rows with workshop_id null match only the admin branch.

do $$
declare
  t text;
begin
  foreach t in array array['stock_balances', 'stock_moves', 'activity_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using ((select private.is_admin()) or workshop_id = (select private.my_workshop_id()))',
      t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reset and test helpers (SPEC §15, §17). The list is in FK order (parents first), so the
-- demo reset can copy in this order. Never workshops, profiles, auth.*, demo_meta; doc_counters
-- are reset to 1 rather than truncated, idempotency is truncated separately by reset_demo, and
-- app_errors is kept.

create function private.reset_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'suppliers', 'vehicle_models', 'model_variants', 'parts', 'part_fitments', 'supplier_parts',
    'finding_types', 'finding_type_parts', 'bins', 'reorder_settings',
    'bikes', 'job_cards', 'job_card_lines', 'inspection_findings',
    'purchase_orders', 'po_lines', 'grns', 'grn_lines', 'emergency_buys',
    'stock_moves', 'stock_balances', 'activity_log'
  ]::text[]
$$;

-- Tests only (called as postgres; no grants).
create function private.test_clear()
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute 'truncate table '
    || (select string_agg(format('public.%I', t), ', ') from unnest(private.reset_tables()) as t)
    || ' restart identity';
  update public.doc_counters set next_no = 1;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (none for clients).

revoke execute on function private.forbid_mutation() from public, anon;
revoke execute on function private.stock_moves_check() from public, anon;
revoke execute on function private.stock_moves_apply() from public, anon;
revoke execute on function private.reset_tables() from public, anon;
revoke execute on function private.test_clear() from public, anon;
