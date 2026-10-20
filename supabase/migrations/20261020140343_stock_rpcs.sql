-- Stock helpers (SPEC §5.2, §6, §3.1 doc codes) and the stock RPCs (SPEC §8.4), plus the parts
-- search read RPC (SPEC §14). Every mutating RPC follows SPEC §11.1: begin_request, load target,
-- authorize, lock workshop, work, activity_log, invariant check, finish_request.

-- ---------------------------------------------------------------------------------------------
-- Small shared helpers.

-- The one activity_log row every mutating RPC writes (SPEC §3.5).
create function private.log_activity(
  p_workshop_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_summary jsonb,
  p_request_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.activity_log (workshop_id, entity_type, entity_id, action, summary, user_id, request_id)
  values (p_workshop_id, p_entity_type, p_entity_id, p_action, coalesce(p_summary, '{}'), auth.uid(), p_request_id);
end
$$;

-- SPEC §11.1 step 6.
create function private.assert_invariants(p_workshop_id uuid, p_part_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  select jsonb_agg(to_jsonb(r)) into v_rows
  from private.check_invariants_for(p_workshop_id, p_part_ids) r;
  if v_rows is not null then
    perform private.err('INVARIANT_VIOLATION', jsonb_build_object('rows', v_rows));
  end if;
end
$$;

create function private.require_part(p_part_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.parts p where p.id = p_part_id) then
    perform private.err('NOT_FOUND', jsonb_build_object('part_id', p_part_id));
  end if;
end
$$;

create function private.bin_on_hand(p_bin_id uuid, p_part_id uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select b.on_hand from public.stock_balances b where b.bin_id = p_bin_id and b.part_id = p_part_id
  ), 0)
$$;

-- ---------------------------------------------------------------------------------------------
-- The only function that inserts stock_moves. Bin rules and balances are enforced by the
-- stock_moves triggers.

create function private.post_move(
  p_workshop_id uuid,
  p_part_id uuid,
  p_move_type public.move_type,
  p_qty int,
  p_from_bin_id uuid,
  p_to_bin_id uuid,
  p_request_id uuid,
  p_reason text default null,
  p_note text default null,
  p_job_card_line_id uuid default null,
  p_grn_line_id uuid default null,
  p_emergency_buy_id uuid default null
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.stock_moves (
    workshop_id, part_id, move_type, qty, from_bin_id, to_bin_id, job_card_line_id, grn_line_id,
    emergency_buy_id, reason, note, user_id, request_id, is_simulated
  ) values (
    p_workshop_id, p_part_id, p_move_type, p_qty, p_from_bin_id, p_to_bin_id, p_job_card_line_id, p_grn_line_id,
    p_emergency_buy_id, p_reason, p_note, auth.uid(), p_request_id, false
  )
  returning id into v_id;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- parts_complete_at (SPEC §5.2, §4 item 9). Only confirmed cards are touched here; the RPCs
-- that close or cancel a card set it themselves.

create function private.refresh_card_completeness(p_card_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_complete boolean;
begin
  select c.needs_review_reason is null and not exists (
      select 1 from public.job_card_lines l
      where l.job_card_id = c.id and l.cancelled_at is null
        and l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) > 0
    )
  into v_complete
  from public.job_cards c
  where c.id = p_card_id and c.status = 'confirmed';

  if v_complete is null then
    return;
  end if;

  update public.job_cards c
  set parts_complete_at = case when v_complete then now() end
  where c.id = p_card_id and (c.parts_complete_at is null) = v_complete;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Allocation (SPEC §6). Callers hold the workshop lock.

-- Reserves available stock: the priority line first (if it has uncovered need), then FIFO by
-- needed_by, confirmed_at, line id. Fills each line fully before the next; never takes a
-- reservation away. Returns [{line_id, card_code, reg_no, qty}].
create function private.allocate_free_stock(p_workshop_id uuid, p_part_id uuid, p_priority_line_id uuid default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_available int;
  v_take int;
  v_result jsonb := '[]';
  v_cards uuid[] := '{}';
  v_card uuid;
  r record;
begin
  select s.available into v_available from private.stock_position(p_workshop_id, array[p_part_id]) s;
  if coalesce(v_available, 0) <= 0 then
    return v_result;
  end if;

  for r in
    select l.id as line_id, c.id as card_id, c.code as card_code, b.reg_no,
      l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) as uncovered
    from public.job_card_lines l
    join public.job_cards c on c.id = l.job_card_id
    join public.bikes b on b.id = c.bike_id
    where l.workshop_id = p_workshop_id
      and l.part_id = p_part_id
      and l.cancelled_at is null
      and c.status = 'confirmed'
      and l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) > 0
    order by (l.id is not distinct from p_priority_line_id) desc,
      c.needed_by asc nulls last, c.confirmed_at asc, l.id asc
    for update of l
  loop
    exit when v_available <= 0;
    v_take := least(v_available, r.uncovered);
    update public.job_card_lines set qty_reserved = qty_reserved + v_take where id = r.line_id;
    v_available := v_available - v_take;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'line_id', r.line_id, 'card_code', r.card_code, 'reg_no', r.reg_no, 'qty', v_take));
    if not (r.card_id = any (v_cards)) then
      v_cards := v_cards || r.card_id;
    end if;
  end loop;

  foreach v_card in array v_cards loop
    perform private.refresh_card_completeness(v_card);
  end loop;
  return v_result;
end
$$;

-- If reserved > usable_on_hand, releases the excess in reverse FIFO order and returns the codes
-- of the cards that lost reservations.
create function private.dereserve_excess(p_workshop_id uuid, p_part_id uuid)
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_excess int;
  v_take int;
  v_codes text[] := '{}';
  v_cards uuid[] := '{}';
  v_card uuid;
  r record;
begin
  select s.reserved - s.usable_on_hand into v_excess
  from private.stock_position(p_workshop_id, array[p_part_id]) s;
  if coalesce(v_excess, 0) <= 0 then
    return v_codes;
  end if;

  for r in
    select l.id as line_id, c.id as card_id, c.code as card_code, l.qty_reserved
    from public.job_card_lines l
    join public.job_cards c on c.id = l.job_card_id
    where l.workshop_id = p_workshop_id
      and l.part_id = p_part_id
      and l.qty_reserved > 0
    order by c.needed_by desc nulls first, c.confirmed_at desc, l.id desc
    for update of l
  loop
    exit when v_excess <= 0;
    v_take := least(v_excess, r.qty_reserved);
    update public.job_card_lines set qty_reserved = qty_reserved - v_take where id = r.line_id;
    v_excess := v_excess - v_take;
    if not (r.card_id = any (v_cards)) then
      v_cards := v_cards || r.card_id;
      v_codes := v_codes || r.card_code;
    end if;
  end loop;

  foreach v_card in array v_cards loop
    perform private.refresh_card_completeness(v_card);
  end loop;
  return v_codes;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Document codes (SPEC §3.1): JC-NCR-000123, PO-JPR-000045, GRN-NCR-000012. Callers hold the
-- workshop lock.

create function private.next_code(p_workshop_id uuid, p_doc_type public.doc_type)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_no int;
  v_ws text;
begin
  update public.doc_counters
  set next_no = next_no + 1
  where workshop_id = p_workshop_id and doc_type = p_doc_type
  returning next_no - 1 into v_no;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('workshop_id', p_workshop_id, 'doc_type', p_doc_type));
  end if;
  select w.code into v_ws from public.workshops w where w.id = p_workshop_id;
  return case p_doc_type when 'job_card' then 'JC' when 'po' then 'PO' when 'grn' then 'GRN' end
    || '-' || v_ws || '-' || lpad(v_no::text, greatest(6, length(v_no::text)), '0');
end
$$;

-- ---------------------------------------------------------------------------------------------
-- putaway (store_keeper): receiving -> normal only. normal -> normal is move_stock.

create function public.putaway(p_request_id uuid, p_part_id uuid, p_from_bin_id uuid, p_to_bin_id uuid, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'putaway';
  v_done jsonb;
  v_from public.bins;
  v_to public.bins;
  v_on_hand int;
  v_move_id bigint;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'part_id', p_part_id, 'from_bin_id', p_from_bin_id, 'to_bin_id', p_to_bin_id, 'qty', p_qty));
  if v_done is not null then
    return v_done;
  end if;

  if p_qty is null or p_qty not between 1 and 999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;

  select * into v_from from public.bins where id = p_from_bin_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bin_id', p_from_bin_id));
  end if;

  perform private.authorize('store_keeper', v_from.workshop_id);

  select * into v_to from public.bins where id = p_to_bin_id and workshop_id = v_from.workshop_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bin_id', p_to_bin_id));
  end if;
  perform private.require_part(p_part_id);
  if v_from.kind <> 'receiving' or v_to.kind <> 'normal' then
    perform private.err('BIN_KIND_NOT_ALLOWED', jsonb_build_object(
      'move_type', 'putaway', 'from_kind', v_from.kind, 'to_kind', v_to.kind));
  end if;

  perform private.lock_workshop(v_from.workshop_id);

  v_on_hand := private.bin_on_hand(p_from_bin_id, p_part_id);
  if v_on_hand < p_qty then
    perform private.err('INSUFFICIENT_BIN_STOCK', jsonb_build_object(
      'bin_id', p_from_bin_id, 'part_id', p_part_id, 'on_hand', v_on_hand, 'qty', p_qty));
  end if;

  v_move_id := private.post_move(v_from.workshop_id, p_part_id, 'putaway', p_qty, p_from_bin_id, p_to_bin_id, p_request_id);

  v_result := jsonb_build_object(
    'move_id', v_move_id, 'part_id', p_part_id, 'qty', p_qty,
    'from_bin_id', p_from_bin_id, 'from_on_hand', private.bin_on_hand(p_from_bin_id, p_part_id),
    'to_bin_id', p_to_bin_id, 'to_on_hand', private.bin_on_hand(p_to_bin_id, p_part_id));
  perform private.log_activity(v_from.workshop_id, 'part', p_part_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_from.workshop_id, array[p_part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- move_stock (SPEC §8.4, §3.4): normal|receiving -> normal; normal|receiving -> quarantine
-- (reason); quarantine -> normal (manager, reason).

create function public.move_stock(
  p_request_id uuid,
  p_part_id uuid,
  p_from_bin_id uuid,
  p_to_bin_id uuid,
  p_qty int,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'move_stock';
  v_done jsonb;
  v_from public.bins;
  v_to public.bins;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_on_hand int;
  v_move_id bigint;
  v_released text[] := '{}';
  v_allocated jsonb := '[]';
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'part_id', p_part_id, 'from_bin_id', p_from_bin_id, 'to_bin_id', p_to_bin_id, 'qty', p_qty,
    'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  if p_qty is null or p_qty not between 1 and 999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;

  select * into v_from from public.bins where id = p_from_bin_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bin_id', p_from_bin_id));
  end if;

  perform private.authorize(
    case when v_from.kind = 'quarantine' then 'manager' else 'store_keeper' end::public.app_role,
    v_from.workshop_id);

  select * into v_to from public.bins where id = p_to_bin_id and workshop_id = v_from.workshop_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bin_id', p_to_bin_id));
  end if;
  perform private.require_part(p_part_id);
  if v_from.id = v_to.id then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'same_bin'));
  end if;
  if not (
    (v_from.kind in ('normal', 'receiving') and v_to.kind in ('normal', 'quarantine'))
    or (v_from.kind = 'quarantine' and v_to.kind = 'normal')
  ) then
    perform private.err('BIN_KIND_NOT_ALLOWED', jsonb_build_object(
      'move_type', 'move', 'from_kind', v_from.kind, 'to_kind', v_to.kind));
  end if;
  if v_reason is null and (v_from.kind = 'quarantine' or v_to.kind = 'quarantine') then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reason'));
  end if;

  perform private.lock_workshop(v_from.workshop_id);

  v_on_hand := private.bin_on_hand(p_from_bin_id, p_part_id);
  if v_on_hand < p_qty then
    perform private.err('INSUFFICIENT_BIN_STOCK', jsonb_build_object(
      'bin_id', p_from_bin_id, 'part_id', p_part_id, 'on_hand', v_on_hand, 'qty', p_qty));
  end if;

  v_move_id := private.post_move(
    v_from.workshop_id, p_part_id, 'move', p_qty, p_from_bin_id, p_to_bin_id, p_request_id, v_reason);

  if v_to.kind = 'quarantine' then
    v_released := private.dereserve_excess(v_from.workshop_id, p_part_id);
  elsif v_from.kind = 'quarantine' then
    v_allocated := private.allocate_free_stock(v_from.workshop_id, p_part_id);
  end if;

  v_result := jsonb_build_object(
    'move_id', v_move_id, 'part_id', p_part_id, 'qty', p_qty,
    'from_bin_id', p_from_bin_id, 'from_on_hand', private.bin_on_hand(p_from_bin_id, p_part_id),
    'to_bin_id', p_to_bin_id, 'to_on_hand', private.bin_on_hand(p_to_bin_id, p_part_id),
    'released', to_jsonb(v_released), 'allocated', v_allocated);
  perform private.log_activity(v_from.workshop_id, 'part', p_part_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_from.workshop_id, array[p_part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- adjust_stock (manager, SPEC §8.4): cycle count. STALE_COUNT when the bin changed since the
-- count screen loaded. Any call, including a no-op count, clears the bin's count request.

create function public.adjust_stock(
  p_request_id uuid,
  p_bin_id uuid,
  p_part_id uuid,
  p_counted_qty int,
  p_expected_on_hand int,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'adjust_stock';
  v_done jsonb;
  v_bin public.bins;
  v_current int;
  v_delta int;
  v_move_id bigint;
  v_released text[] := '{}';
  v_allocated jsonb := '[]';
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'bin_id', p_bin_id, 'part_id', p_part_id, 'counted_qty', p_counted_qty,
    'expected_on_hand', p_expected_on_hand, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  if p_counted_qty is null or p_counted_qty not between 0 and 9999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_counted_qty'));
  end if;
  if p_expected_on_hand is null or p_expected_on_hand < 0 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_expected_on_hand'));
  end if;
  if p_reason is null or p_reason not in ('count_correction', 'lost', 'found') then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reason'));
  end if;

  select * into v_bin from public.bins where id = p_bin_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bin_id', p_bin_id));
  end if;

  perform private.authorize('manager', v_bin.workshop_id);
  perform private.require_part(p_part_id);

  perform private.lock_workshop(v_bin.workshop_id);

  v_current := private.bin_on_hand(p_bin_id, p_part_id);
  if v_current <> p_expected_on_hand then
    perform private.err('STALE_COUNT', jsonb_build_object(
      'bin_id', p_bin_id, 'part_id', p_part_id, 'expected', p_expected_on_hand, 'current', v_current));
  end if;

  v_delta := p_counted_qty - v_current;
  if v_delta > 0 then
    v_move_id := private.post_move(
      v_bin.workshop_id, p_part_id, 'adjust_in', v_delta, null, p_bin_id, p_request_id, p_reason);
  elsif v_delta < 0 then
    v_move_id := private.post_move(
      v_bin.workshop_id, p_part_id, 'adjust_out', -v_delta, p_bin_id, null, p_request_id, p_reason);
  end if;

  update public.bins set count_requested_at = null
  where id = p_bin_id and count_requested_at is not null;

  if v_delta < 0 then
    v_released := private.dereserve_excess(v_bin.workshop_id, p_part_id);
  elsif v_delta > 0 then
    v_allocated := private.allocate_free_stock(v_bin.workshop_id, p_part_id);
  end if;

  v_result := jsonb_build_object(
    'move_id', v_move_id, 'bin_id', p_bin_id, 'part_id', p_part_id, 'delta', v_delta,
    'on_hand', private.bin_on_hand(p_bin_id, p_part_id),
    'released', to_jsonb(v_released), 'allocated', v_allocated);
  perform private.log_activity(v_bin.workshop_id, 'part', p_part_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_bin.workshop_id, array[p_part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- return_to_supplier (manager, SPEC §8.4): from the workshop's quarantine bin only.

create function public.return_to_supplier(p_request_id uuid, p_bin_id uuid, p_part_id uuid, p_qty int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'return_to_supplier';
  v_done jsonb;
  v_bin public.bins;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_on_hand int;
  v_move_id bigint;
  v_released text[];
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'bin_id', p_bin_id, 'part_id', p_part_id, 'qty', p_qty, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  if p_qty is null or p_qty not between 1 and 999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;
  if v_reason is null then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reason'));
  end if;

  select * into v_bin from public.bins where id = p_bin_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bin_id', p_bin_id));
  end if;

  perform private.authorize('manager', v_bin.workshop_id);
  perform private.require_part(p_part_id);
  if v_bin.kind <> 'quarantine' then
    perform private.err('BIN_KIND_NOT_ALLOWED', jsonb_build_object(
      'move_type', 'return_to_supplier', 'from_kind', v_bin.kind));
  end if;

  perform private.lock_workshop(v_bin.workshop_id);

  v_on_hand := private.bin_on_hand(p_bin_id, p_part_id);
  if v_on_hand < p_qty then
    perform private.err('INSUFFICIENT_BIN_STOCK', jsonb_build_object(
      'bin_id', p_bin_id, 'part_id', p_part_id, 'on_hand', v_on_hand, 'qty', p_qty));
  end if;

  v_move_id := private.post_move(
    v_bin.workshop_id, p_part_id, 'return_to_supplier', p_qty, p_bin_id, null, p_request_id, v_reason);
  v_released := private.dereserve_excess(v_bin.workshop_id, p_part_id);

  v_result := jsonb_build_object(
    'move_id', v_move_id, 'bin_id', p_bin_id, 'part_id', p_part_id, 'qty', p_qty,
    'on_hand', private.bin_on_hand(p_bin_id, p_part_id), 'released', to_jsonb(v_released));
  perform private.log_activity(v_bin.workshop_id, 'part', p_part_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_bin.workshop_id, array[p_part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- request_bin_count (store_keeper, SPEC §8.4): puts the bin on the manager's count list.

create function public.request_bin_count(p_request_id uuid, p_bin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'request_bin_count';
  v_done jsonb;
  v_bin public.bins;
  v_requested_at timestamptz;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('bin_id', p_bin_id));
  if v_done is not null then
    return v_done;
  end if;

  select * into v_bin from public.bins where id = p_bin_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bin_id', p_bin_id));
  end if;

  perform private.authorize('store_keeper', v_bin.workshop_id);
  perform private.lock_workshop(v_bin.workshop_id);

  update public.bins set count_requested_at = now()
  where id = p_bin_id
  returning count_requested_at into v_requested_at;

  v_result := jsonb_build_object('bin_id', p_bin_id, 'count_requested_at', v_requested_at);
  perform private.log_activity(v_bin.workshop_id, 'bin', p_bin_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_bin.workshop_id, '{}'::uuid[]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Parts search (SPEC §14). array_to_string is not immutable, so the trigram index goes over
-- this wrapper. Executable by authenticated (SPEC §11.2) because search_parts runs as the caller.

create function private.parts_search_text(p_name text, p_name_hi text, p_aliases text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select p_name || ' ' || coalesce(p_name_hi, '') || ' ' || coalesce(pg_catalog.array_to_string(p_aliases, ' '), '')
$$;

create index parts_search_trgm_idx on public.parts
  using gin (private.parts_search_text(name, name_hi, aliases) extensions.gin_trgm_ops);

-- Trigram word similarity over name, name_hi and aliases (so a short alias like 'mobil' matches
-- inside the longer text), substring match, and prefix match on oem_part_no_norm and sku.
-- Order: fitting parts first when a variant is given, then prefix matches, then similarity.
-- Availability comes from v_stock_position under the caller's RLS, so another workshop's
-- numbers are never shown (null instead).
create function public.search_parts(
  p_q text,
  p_workshop_id uuid,
  p_variant_id uuid default null,
  p_part_type text default null
)
returns table (
  part_id uuid,
  sku text,
  name text,
  name_hi text,
  oem_part_no text,
  uom public.uom,
  category public.part_category,
  part_type text,
  is_universal boolean,
  fits boolean,
  usable_on_hand int,
  available int
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with q as (
    select t.raw,
      upper(regexp_replace(t.raw, '[^A-Za-z0-9]', '', 'g')) as norm,
      replace(replace(replace(t.raw, '\', '\\'), '%', '\%'), '_', '\_') as esc
    from (select btrim(coalesce(p_q, '')) as raw) t
    where char_length(t.raw) >= 2
  ),
  hits as (
    select p.id, p.sku, p.name, p.name_hi, p.oem_part_no, p.uom, p.category, p.part_type, p.is_universal,
      case when p_variant_id is not null then exists (
        select 1 from public.part_fitments f
        where f.part_id = p.id and f.variant_id = p_variant_id
          and (f.source = 'catalogue' or f.confirmed_count >= 1)
          and f.flagged_count < greatest(1, f.confirmed_count)
      ) end as fits,
      coalesce(q.norm <> '' and p.oem_part_no_norm like q.norm || '%', false)
        or upper(p.sku) like upper(q.esc) || '%' as prefix,
      word_similarity(q.raw, private.parts_search_text(p.name, p.name_hi, p.aliases)) as score
    from public.parts p
    cross join q
    where p.is_active
      and (p_part_type is null or p.part_type = p_part_type)
      and (
        q.raw <% private.parts_search_text(p.name, p.name_hi, p.aliases)
        or private.parts_search_text(p.name, p.name_hi, p.aliases) ilike '%' || q.esc || '%'
        or (q.norm <> '' and p.oem_part_no_norm like q.norm || '%')
        or upper(p.sku) like upper(q.esc) || '%'
      )
  ),
  top as (
    select * from hits h
    order by coalesce(h.fits, false) desc, h.prefix desc, h.score desc, h.sku
    limit 20
  )
  select h.id, h.sku, h.name, h.name_hi, h.oem_part_no, h.uom, h.category, h.part_type, h.is_universal, h.fits,
    sp.usable_on_hand, sp.available
  from top h
  left join public.v_stock_position sp
    on sp.part_id = h.id and sp.workshop_id = coalesce(p_workshop_id, private.my_workshop_id())
  order by coalesce(h.fits, false) desc, h.prefix desc, h.score desc, h.sku
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function private.log_activity(uuid, text, uuid, text, jsonb, uuid) from public, anon;
revoke execute on function private.assert_invariants(uuid, uuid[]) from public, anon;
revoke execute on function private.require_part(uuid) from public, anon;
revoke execute on function private.bin_on_hand(uuid, uuid) from public, anon;
revoke execute on function private.post_move(uuid, uuid, public.move_type, int, uuid, uuid, uuid, text, text, uuid, uuid, uuid) from public, anon;
revoke execute on function private.refresh_card_completeness(uuid) from public, anon;
revoke execute on function private.allocate_free_stock(uuid, uuid, uuid) from public, anon;
revoke execute on function private.dereserve_excess(uuid, uuid) from public, anon;
revoke execute on function private.next_code(uuid, public.doc_type) from public, anon;
revoke execute on function private.parts_search_text(text, text, text[]) from public, anon;
revoke execute on function public.putaway(uuid, uuid, uuid, uuid, int) from public, anon;
revoke execute on function public.move_stock(uuid, uuid, uuid, uuid, int, text) from public, anon;
revoke execute on function public.adjust_stock(uuid, uuid, uuid, int, int, text) from public, anon;
revoke execute on function public.return_to_supplier(uuid, uuid, uuid, int, text) from public, anon;
revoke execute on function public.request_bin_count(uuid, uuid) from public, anon;
revoke execute on function public.search_parts(text, uuid, uuid, text) from public, anon;

grant execute on function private.parts_search_text(text, text, text[]) to authenticated;
grant execute on function public.putaway(uuid, uuid, uuid, uuid, int) to authenticated;
grant execute on function public.move_stock(uuid, uuid, uuid, uuid, int, text) to authenticated;
grant execute on function public.adjust_stock(uuid, uuid, uuid, int, int, text) to authenticated;
grant execute on function public.return_to_supplier(uuid, uuid, uuid, int, text) to authenticated;
grant execute on function public.request_bin_count(uuid, uuid) to authenticated;
grant execute on function public.search_parts(text, uuid, uuid, text) to authenticated;
