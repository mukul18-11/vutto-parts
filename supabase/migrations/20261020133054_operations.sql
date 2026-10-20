-- Operations (SPEC §3.2, §3.3, §3.4 emergency_buys): bikes, inspection findings, job cards and
-- lines, purchase orders, GRNs, emergency buys. Workshop-scoped parents carry UNIQUE
-- (workshop_id, id) so every child references them with a composite FK and can never point
-- into another workshop.

create type public.bike_status as enum ('purchased', 'at_workshop', 'in_repair', 'ready', 'cancelled');
create type public.job_card_status as enum ('draft', 'confirmed', 'closed', 'cancelled');
create type public.line_source as enum ('suggested', 'manual', 'extra');
create type public.line_status as enum ('needed', 'partially_reserved', 'reserved', 'issued', 'cancelled');
create type public.po_status as enum ('draft', 'sent', 'partially_received', 'received', 'closed', 'cancelled');
create type public.po_line_source as enum ('suggested', 'manual');
create type public.emergency_reason as enum ('no_stock', 'supplier_late', 'wrong_part_received', 'other');

-- ---------------------------------------------------------------------------------------------
-- Bikes.

create table public.bikes (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  reg_no text not null,
  reg_no_norm text generated always as (upper(regexp_replace(reg_no, '[^A-Za-z0-9]', '', 'g'))) stored,
  model_id uuid not null references public.vehicle_models (id) on delete restrict,
  variant_id uuid null references public.model_variants (id) on delete restrict,
  mfg_year int not null,
  status public.bike_status not null default 'purchased',
  purchased_at timestamptz not null,
  arrived_at timestamptz null,
  bay_in_at timestamptz null,
  ready_at timestamptz null,
  cancelled_at timestamptz null,
  cancel_reason text null,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workshop_id, id),
  check (arrived_at is null or arrived_at >= purchased_at),
  check (bay_in_at is null or (arrived_at is not null and bay_in_at >= arrived_at)),
  check (ready_at is null or (bay_in_at is not null and ready_at >= bay_in_at)),
  check (status not in ('at_workshop', 'in_repair', 'ready') or arrived_at is not null),
  check (status not in ('in_repair', 'ready') or bay_in_at is not null),
  check (status <> 'ready' or ready_at is not null),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create unique index bikes_reg_no_norm_active on public.bikes (reg_no_norm) where status <> 'cancelled';
create index bikes_workshop_status_idx on public.bikes (workshop_id, status);

-- Variant belongs to the model; mfg_year in range (SPEC §3.2). Checked on insert and whenever
-- year, model or variant changes (a later year_to edit never blocks unrelated updates).
create function private.bikes_check_model()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_variant public.model_variants;
  v_max int := extract(year from private.ist_today())::int;
  v_lo int := 1995;
  v_hi int;
begin
  if tg_op = 'UPDATE'
     and new.mfg_year is not distinct from old.mfg_year
     and new.model_id is not distinct from old.model_id
     and new.variant_id is not distinct from old.variant_id then
    return new;
  end if;

  v_hi := v_max;
  if new.variant_id is not null then
    select * into v_variant from public.model_variants where id = new.variant_id;
    if v_variant.model_id is distinct from new.model_id then
      perform private.err('VALIDATION', jsonb_build_object('reason', 'variant_not_of_model'));
    end if;
    v_lo := greatest(v_lo, v_variant.year_from);
    v_hi := least(v_hi, coalesce(v_variant.year_to, v_max));
  end if;

  if new.mfg_year < v_lo or new.mfg_year > v_hi then
    perform private.err('MFG_YEAR_OUT_OF_RANGE', jsonb_build_object(
      'mfg_year', new.mfg_year, 'min', v_lo, 'max', v_hi));
  end if;
  return new;
end
$$;

create trigger bikes_check_model
before insert or update on public.bikes
for each row execute function private.bikes_check_model();

-- Status transitions (SPEC §5.1). Enforced on UPDATE only, so fixtures and the seed copy may
-- insert rows with explicit past timestamps.
create function private.bikes_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if new.workshop_id is distinct from old.workshop_id then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'workshop_immutable'));
  end if;

  if new.status is distinct from old.status then
    v_ok := case
      when old.status = 'purchased' and new.status = 'at_workshop' then true
      when old.status = 'at_workshop' and new.status = 'in_repair' then true
      when old.status = 'in_repair' and new.status = 'ready' then true
      when old.status in ('purchased', 'at_workshop', 'in_repair') and new.status = 'cancelled' then true
      else false
    end;
    if not v_ok then
      perform private.err('INVALID_TRANSITION', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.status = 'in_repair' and not exists (
      select 1 from public.job_cards c where c.bike_id = new.id and c.status = 'confirmed'
    ) then
      perform private.err('INVALID_TRANSITION', jsonb_build_object(
        'from', old.status, 'to', new.status, 'reason', 'no_confirmed_job_card'));
    end if;
  end if;

  -- A set timestamp is never overwritten.
  if (old.purchased_at is distinct from new.purchased_at)
     or (old.arrived_at is not null and new.arrived_at is distinct from old.arrived_at)
     or (old.bay_in_at is not null and new.bay_in_at is distinct from old.bay_in_at)
     or (old.ready_at is not null and new.ready_at is distinct from old.ready_at)
     or (old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at) then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('reason', 'timestamp_overwrite'));
  end if;

  -- Each timestamp is newly set only by its own transition.
  if (old.arrived_at is null and new.arrived_at is not null and new.status is distinct from 'at_workshop')
     or (old.bay_in_at is null and new.bay_in_at is not null and new.status is distinct from 'in_repair')
     or (old.ready_at is null and new.ready_at is not null and new.status is distinct from 'ready')
     or (old.cancelled_at is null and new.cancelled_at is not null and new.status is distinct from 'cancelled') then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('reason', 'timestamp_without_transition'));
  end if;
  return new;
end
$$;

create trigger bikes_transition
before update on public.bikes
for each row execute function private.bikes_transition();

-- ---------------------------------------------------------------------------------------------
-- Job cards and lines.

create table public.job_cards (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  code text not null unique,
  bike_id uuid not null,
  status public.job_card_status not null default 'draft',
  needed_by date null,
  needs_review_reason text null,
  confirmed_at timestamptz null,
  confirmed_by uuid null,
  parts_complete_at timestamptz null,
  closed_at timestamptz null,
  cancelled_at timestamptz null,
  cancel_reason text null,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workshop_id, id),
  foreign key (workshop_id, bike_id) references public.bikes (workshop_id, id),
  check (status <> 'draft' or (confirmed_at is null and confirmed_by is null)),
  check (status not in ('confirmed', 'closed') or (confirmed_at is not null and confirmed_by is not null)),
  check ((status = 'closed') = (closed_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create unique index job_cards_one_open_per_bike on public.job_cards (bike_id) where status in ('draft', 'confirmed');
create index job_cards_bike_id_idx on public.job_cards (bike_id);
create index job_cards_workshop_status_idx on public.job_cards (workshop_id, status);

create table public.job_card_lines (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  job_card_id uuid not null,
  part_id uuid not null references public.parts (id) on delete restrict,
  qty_required int not null check (qty_required >= 0),
  qty_reserved int not null default 0 check (qty_reserved >= 0),
  qty_issued int not null default 0 check (qty_issued >= 0),
  qty_returned int not null default 0 check (qty_returned >= 0),
  source public.line_source not null,
  added_reason text null,
  cancelled_at timestamptz null,
  cancel_reason text null,
  -- SPEC §3.2: computed from base columns only; no code writes it.
  status public.line_status generated always as (
    case
      when cancelled_at is not null then 'cancelled'::public.line_status
      when qty_issued - qty_returned >= qty_required then 'issued'::public.line_status
      when qty_reserved + qty_issued - qty_returned >= qty_required then 'reserved'::public.line_status
      when qty_reserved + qty_issued - qty_returned > 0 then 'partially_reserved'::public.line_status
      else 'needed'::public.line_status
    end
  ) stored,
  created_at timestamptz not null default now(),
  unique (workshop_id, id),
  foreign key (workshop_id, job_card_id) references public.job_cards (workshop_id, id),
  check (qty_returned <= qty_issued),
  check (qty_reserved + (qty_issued - qty_returned) <= qty_required),
  check (cancelled_at is null or qty_reserved = 0)
);
create unique index job_card_lines_one_live_per_part on public.job_card_lines (job_card_id, part_id)
  where cancelled_at is null;
create index job_card_lines_workshop_part_idx on public.job_card_lines (workshop_id, part_id);

-- part_id is fixed once the card leaves draft; only confirmed cards hold reservations.
create function private.job_card_lines_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.job_card_status;
begin
  select c.status into v_status from public.job_cards c where c.id = new.job_card_id;
  if tg_op = 'UPDATE' and new.part_id is distinct from old.part_id and v_status is distinct from 'draft' then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'part_immutable_after_confirm'));
  end if;
  if new.qty_reserved > 0 and v_status is distinct from 'confirmed' then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'reservation_needs_confirmed_card'));
  end if;
  return new;
end
$$;

create trigger job_card_lines_check
before insert or update on public.job_card_lines
for each row execute function private.job_card_lines_check();

-- The other half of "only confirmed cards hold reservations": a card cannot leave confirmed
-- while a line still holds units (RPCs release reservations before changing the card).
create function private.job_cards_status_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'confirmed' and new.status <> 'confirmed' and exists (
    select 1 from public.job_card_lines l where l.job_card_id = new.id and l.qty_reserved > 0
  ) then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'card_holds_reservations'));
  end if;
  return null;
end
$$;

create trigger job_cards_status_check
after update of status on public.job_cards
for each row execute function private.job_cards_status_check();

-- ---------------------------------------------------------------------------------------------
-- Inspection findings.

create table public.inspection_findings (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  bike_id uuid not null,
  finding_type_id uuid not null references public.finding_types (id) on delete restrict,
  qty int null check (qty > 0),
  notes text null,
  job_card_line_id uuid null,
  no_part_reason text null,
  created_at timestamptz not null default now(),
  foreign key (workshop_id, bike_id) references public.bikes (workshop_id, id),
  foreign key (workshop_id, job_card_line_id) references public.job_card_lines (workshop_id, id)
);
create index inspection_findings_bike_id_idx on public.inspection_findings (bike_id);
create index inspection_findings_job_card_line_id_idx on public.inspection_findings (job_card_line_id);

-- Findings are immutable while the bike has a confirmed or closed card (a cancelled card does
-- not lock them). A linked line must be on a card of the same bike.
create function private.inspection_findings_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bike uuid;
begin
  foreach v_bike in array case tg_op
    when 'INSERT' then array[new.bike_id]
    when 'DELETE' then array[old.bike_id]
    else array[old.bike_id, new.bike_id]
  end loop
    if exists (
      select 1 from public.job_cards c where c.bike_id = v_bike and c.status in ('confirmed', 'closed')
    ) then
      perform private.err('FINDINGS_LOCKED');
    end if;
  end loop;

  if tg_op <> 'DELETE' and new.job_card_line_id is not null and not exists (
    select 1
    from public.job_card_lines l
    join public.job_cards c on c.id = l.job_card_id
    where l.id = new.job_card_line_id and c.bike_id = new.bike_id
  ) then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'line_not_on_this_bike'));
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger inspection_findings_check
before insert or update or delete on public.inspection_findings
for each row execute function private.inspection_findings_check();

-- ---------------------------------------------------------------------------------------------
-- Purchasing (SPEC §3.3).

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  code text not null unique,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  status public.po_status not null default 'draft',
  sent_at timestamptz null,
  expected_on date null,
  cancel_reason text null,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workshop_id, id)
);
create unique index purchase_orders_one_draft_per_supplier on public.purchase_orders (workshop_id, supplier_id)
  where status = 'draft';
create index purchase_orders_workshop_status_idx on public.purchase_orders (workshop_id, status);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  po_id uuid not null,
  part_id uuid not null references public.parts (id) on delete restrict,
  qty_ordered int not null check (qty_ordered > 0),
  qty_accepted int not null default 0 check (qty_accepted >= 0),
  qty_rejected int not null default 0 check (qty_rejected >= 0),
  qty_cancelled int not null default 0 check (qty_cancelled >= 0),
  unit_price_paise bigint null check (unit_price_paise > 0),
  source public.po_line_source not null,
  open_qty int generated always as (qty_ordered - qty_accepted - qty_cancelled) stored,
  created_at timestamptz not null default now(),
  unique (workshop_id, id),
  unique (po_id, part_id),
  foreign key (workshop_id, po_id) references public.purchase_orders (workshop_id, id),
  check (qty_accepted + qty_cancelled <= qty_ordered)
);
create index po_lines_workshop_part_idx on public.po_lines (workshop_id, part_id);

create table public.grns (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  code text not null unique,
  po_id uuid not null,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  supplier_invoice_no text not null check (char_length(supplier_invoice_no) between 1 and 40),
  invoice_no_norm text generated always as (upper(regexp_replace(supplier_invoice_no, '[^A-Za-z0-9]', '', 'g'))) stored,
  invoice_date date not null,
  received_by uuid not null,
  received_at timestamptz not null default now(),
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workshop_id, id),
  foreign key (workshop_id, po_id) references public.purchase_orders (workshop_id, id)
);
create index grns_po_id_idx on public.grns (po_id);
create index grns_supplier_invoice_idx on public.grns (supplier_id, invoice_no_norm);

create table public.grn_lines (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  grn_id uuid not null,
  po_line_id uuid not null,
  part_id uuid not null references public.parts (id) on delete restrict,
  qty_received int not null check (qty_received > 0),
  qty_accepted int not null check (qty_accepted >= 0),
  qty_damaged int not null default 0 check (qty_damaged >= 0),
  qty_wrong_part int not null default 0 check (qty_wrong_part >= 0),
  unit_price_paise bigint not null check (unit_price_paise > 0),
  created_at timestamptz not null default now(),
  unique (workshop_id, id),
  unique (grn_id, po_line_id),
  foreign key (workshop_id, grn_id) references public.grns (workshop_id, id),
  foreign key (workshop_id, po_line_id) references public.po_lines (workshop_id, id),
  check (qty_received = qty_accepted + qty_damaged + qty_wrong_part)
);
create index grn_lines_po_line_id_idx on public.grn_lines (po_line_id);
create index grn_lines_part_id_idx on public.grn_lines (part_id);

-- ---------------------------------------------------------------------------------------------
-- Emergency buys (SPEC §3.4, §8.3).

create table public.emergency_buys (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  job_card_line_id uuid not null,
  part_id uuid not null references public.parts (id) on delete restrict,
  vendor_name text not null,
  qty int not null check (qty between 1 and 50),
  unit_price_paise bigint not null check (unit_price_paise > 0),
  reference_price_paise bigint null,
  qty_issued int not null check (qty_issued >= 0),
  qty_to_stock int not null check (qty_to_stock >= 0),
  reason public.emergency_reason not null,
  note text null,
  bill_photo_path text null,
  bought_by uuid not null,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workshop_id, id),
  foreign key (workshop_id, job_card_line_id) references public.job_card_lines (workshop_id, id),
  check (qty = qty_issued + qty_to_stock)
);
create index emergency_buys_job_card_line_id_idx on public.emergency_buys (job_card_line_id);
create index emergency_buys_workshop_part_idx on public.emergency_buys (workshop_id, part_id);

-- ---------------------------------------------------------------------------------------------
-- RLS (SPEC §11.3): workshop-scoped SELECT. No write policies or grants: RPCs only.

do $$
declare
  t text;
begin
  foreach t in array array[
    'bikes', 'job_cards', 'job_card_lines', 'inspection_findings',
    'purchase_orders', 'po_lines', 'grns', 'grn_lines', 'emergency_buys'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using ((select private.is_admin()) or workshop_id = (select private.my_workshop_id()))',
      t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (trigger functions: no client grants).

revoke execute on function private.bikes_check_model() from public, anon;
revoke execute on function private.bikes_transition() from public, anon;
revoke execute on function private.job_card_lines_check() from public, anon;
revoke execute on function private.job_cards_status_check() from public, anon;
revoke execute on function private.inspection_findings_check() from public, anon;
