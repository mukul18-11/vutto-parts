-- Issue, returns and emergency buys (SPEC §8.1-8.3), the fit badge read (SPEC §9.2), the
-- v_emergency_buys view (premium, SPEC §8.3) and log_app_error (SPEC §11.1). Every mutating RPC
-- except log_app_error follows SPEC §11.1. The bill photo bucket and attach_emergency_bill are
-- not part of this migration.

-- ---------------------------------------------------------------------------------------------
-- Helpers.

-- One job card line for RPC results.
create function private.line_payload(p_line_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'line_id', l.id, 'card_id', c.id, 'card_code', c.code, 'part_id', l.part_id, 'sku', p.sku,
    'qty_required', l.qty_required, 'qty_reserved', l.qty_reserved, 'qty_issued', l.qty_issued,
    'qty_returned', l.qty_returned, 'net_issued', l.qty_issued - l.qty_returned, 'status', l.status,
    'cancelled_at', l.cancelled_at)
  from public.job_card_lines l
  join public.job_cards c on c.id = l.job_card_id
  join public.parts p on p.id = l.part_id
  where l.id = p_line_id
$$;

-- SPEC §8.3 reference price: effective supplier's supplier_parts price ?? last GRN price ??
-- standard price. Effective supplier = reorder_settings override ?? parts.preferred_supplier_id.
create function private.reference_price(p_workshop_id uuid, p_part_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select private.default_po_price(
    coalesce(
      (select rs.preferred_supplier_id from public.reorder_settings rs
       where rs.workshop_id = p_workshop_id and rs.part_id = p_part_id),
      (select p.preferred_supplier_id from public.parts p where p.id = p_part_id)),
    p_part_id)
$$;

-- ---------------------------------------------------------------------------------------------
-- issue_to_job_card (store_keeper, SPEC §8.1): issues line.part_id from one normal or receiving
-- bin, only out of the line's own reservation (after allocating any free stock to it first).

create function public.issue_to_job_card(p_request_id uuid, p_line_id uuid, p_bin_id uuid, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'issue_to_job_card';
  v_done jsonb;
  v_line public.job_card_lines;
  v_card public.job_cards;
  v_bike public.bikes;
  v_bin public.bins;
  v_allocated jsonb;
  v_on_hand int;
  v_move_id bigint;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'line_id', p_line_id, 'bin_id', p_bin_id, 'qty', p_qty));
  if v_done is not null then
    return v_done;
  end if;

  if p_qty is null or p_qty not between 1 and 999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;

  select * into v_line from public.job_card_lines where id = p_line_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('line_id', p_line_id));
  end if;

  perform private.authorize('store_keeper', v_line.workshop_id);

  -- A bin in another workshop is reported exactly like a missing one.
  select * into v_bin from public.bins where id = p_bin_id and workshop_id = v_line.workshop_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bin_id', p_bin_id));
  end if;
  if v_bin.kind not in ('normal', 'receiving') then
    perform private.err('BIN_NOT_ISSUABLE', jsonb_build_object('bin_id', p_bin_id, 'code', v_bin.code, 'kind', v_bin.kind));
  end if;

  perform private.lock_workshop(v_line.workshop_id);

  select * into v_card from public.job_cards where id = v_line.job_card_id for update;
  select * into v_line from public.job_card_lines where id = p_line_id for update;
  select * into v_bike from public.bikes where id = v_card.bike_id;
  if v_card.status <> 'confirmed' then
    perform private.err('JOB_CARD_NOT_CONFIRMED', jsonb_build_object('status', v_card.status));
  end if;
  if v_line.cancelled_at is not null then
    perform private.err('LINE_CANCELLED', jsonb_build_object('line_id', p_line_id));
  end if;
  if v_bike.status not in ('at_workshop', 'in_repair') then
    perform private.err('BIKE_NOT_ARRIVED', jsonb_build_object('bike_status', v_bike.status));
  end if;

  v_allocated := private.allocate_free_stock(v_line.workshop_id, v_line.part_id, p_line_id);
  select * into v_line from public.job_card_lines where id = p_line_id;

  if p_qty > v_line.qty_reserved then
    perform private.err('INSUFFICIENT_RESERVATION', jsonb_build_object(
      'reserved', v_line.qty_reserved,
      'qty', p_qty,
      'available', (select s.available from private.stock_position(v_line.workshop_id, array[v_line.part_id]) s),
      'held_by', (
        select coalesce(jsonb_agg(distinct c.code order by c.code), '[]')
        from public.job_card_lines l
        join public.job_cards c on c.id = l.job_card_id
        where l.workshop_id = v_line.workshop_id and l.part_id = v_line.part_id
          and l.qty_reserved > 0 and l.id <> p_line_id)));
  end if;

  v_on_hand := private.bin_on_hand(p_bin_id, v_line.part_id);
  if p_qty > v_on_hand then
    perform private.err('INSUFFICIENT_BIN_STOCK', jsonb_build_object(
      'bin_id', p_bin_id, 'code', v_bin.code, 'on_hand', v_on_hand, 'qty', p_qty,
      'bins', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'bin_id', b.id, 'code', b.code, 'kind', b.kind, 'on_hand', sb.on_hand) order by b.code), '[]')
        from public.stock_balances sb
        join public.bins b on b.id = sb.bin_id
        where sb.workshop_id = v_line.workshop_id and sb.part_id = v_line.part_id and sb.on_hand > 0
          and b.kind in ('normal', 'receiving') and b.id <> p_bin_id)));
  end if;

  v_move_id := private.post_move(
    v_line.workshop_id, v_line.part_id, 'issue', p_qty, p_bin_id, null, p_request_id,
    null, null, p_line_id);
  update public.job_card_lines
  set qty_reserved = qty_reserved - p_qty, qty_issued = qty_issued + p_qty
  where id = p_line_id;
  perform private.refresh_card_completeness(v_card.id);

  v_result := jsonb_build_object(
    'line', private.line_payload(p_line_id), 'reg_no', v_bike.reg_no, 'qty', p_qty, 'move_id', v_move_id,
    'bin_id', p_bin_id, 'bin_code', v_bin.code, 'bin_on_hand', private.bin_on_hand(p_bin_id, v_line.part_id),
    'allocated', v_allocated);
  perform private.log_activity(v_line.workshop_id, 'job_card_line', p_line_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_line.workshop_id, array[v_line.part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- fit_badge (SPEC §9.2): UI only, the server never blocks on fitment. SECURITY INVOKER, so a
-- line in another workshop returns no row. A fitment counts as confirmed when it is catalogue,
-- or learned with confirmed_count >= 1 (the SPEC §9.1 definition).

create function public.fit_badge(p_line_id uuid)
returns table (badge text, confirmed_count int, flagged_count int, last_flag_note text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    case
      when f.part_id is not null and f.flagged_count >= greatest(1, f.confirmed_count) then 'red'
      when not p.is_universal
        and (f.part_id is null or (f.source = 'learned' and f.confirmed_count < 1)) then 'amber'
      when f.flagged_count > 0 and f.flagged_count < f.confirmed_count then 'amber'
      else 'green'
    end,
    coalesce(f.confirmed_count, 0),
    coalesce(f.flagged_count, 0),
    f.last_flag_note
  from public.job_card_lines l
  join public.job_cards c on c.id = l.job_card_id
  join public.bikes b on b.id = c.bike_id
  join public.parts p on p.id = l.part_id
  left join public.part_fitments f on f.part_id = l.part_id and f.variant_id = b.variant_id
  where l.id = p_line_id
$$;

-- ---------------------------------------------------------------------------------------------
-- return_from_job_card (store_keeper, SPEC §8.2). Confirmed cards only (after close the manager
-- uses adjust_in). qty <= net_issued.

create function public.return_from_job_card(
  p_request_id uuid,
  p_line_id uuid,
  p_qty int,
  p_reason text,
  p_to_bin_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'return_from_job_card';
  v_done jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_line public.job_card_lines;
  v_card public.job_cards;
  v_bike public.bikes;
  v_part public.parts;
  v_bin public.bins;
  v_net int;
  v_move_id bigint;
  v_flagged boolean := false;
  v_allocated jsonb;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'line_id', p_line_id, 'qty', p_qty, 'reason', p_reason, 'to_bin_id', p_to_bin_id, 'note', p_note));
  if v_done is not null then
    return v_done;
  end if;

  if p_qty is null or p_qty not between 1 and 999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;
  if p_reason is null or p_reason not in ('not_needed', 'issued_by_mistake', 'damaged', 'wrong_fitment') then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reason'));
  end if;
  if char_length(v_note) > 500
     or (p_reason = 'wrong_fitment' and coalesce(char_length(v_note), 0) < 5) then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_note'));
  end if;
  if p_reason <> 'damaged' and p_to_bin_id is null then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_to_bin_id'));
  end if;

  select * into v_line from public.job_card_lines where id = p_line_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('line_id', p_line_id));
  end if;

  perform private.authorize('store_keeper', v_line.workshop_id);

  if p_reason = 'damaged' then
    -- to_bin is ignored: damaged units always go to the workshop's quarantine bin.
    select * into v_bin from public.bins where workshop_id = v_line.workshop_id and kind = 'quarantine';
    if not found then
      perform private.err('NOT_FOUND', jsonb_build_object('bin_kind', 'quarantine'));
    end if;
  else
    select * into v_bin from public.bins where id = p_to_bin_id and workshop_id = v_line.workshop_id;
    if not found then
      perform private.err('NOT_FOUND', jsonb_build_object('bin_id', p_to_bin_id));
    end if;
    if v_bin.kind <> 'normal' then
      perform private.err('BIN_KIND_NOT_ALLOWED', jsonb_build_object(
        'move_type', 'return_to_stock', 'to_kind', v_bin.kind));
    end if;
  end if;

  perform private.lock_workshop(v_line.workshop_id);

  select * into v_card from public.job_cards where id = v_line.job_card_id for update;
  select * into v_line from public.job_card_lines where id = p_line_id for update;
  select * into v_bike from public.bikes where id = v_card.bike_id;
  select * into v_part from public.parts where id = v_line.part_id;
  if v_card.status <> 'confirmed' then
    perform private.err('JOB_CARD_NOT_CONFIRMED', jsonb_build_object('status', v_card.status));
  end if;

  v_net := v_line.qty_issued - v_line.qty_returned;
  if p_qty > v_net then
    perform private.err('RETURN_EXCEEDS_ISSUED', jsonb_build_object('net_issued', v_net, 'qty', p_qty));
  end if;

  v_move_id := private.post_move(
    v_line.workshop_id, v_line.part_id,
    case when p_reason = 'damaged' then 'return_to_quarantine' else 'return_to_stock' end::public.move_type,
    p_qty, null, v_bin.id, p_request_id, p_reason, v_note, p_line_id);

  if p_reason = 'not_needed' then
    update public.job_card_lines
    set qty_returned = qty_returned + p_qty, qty_required = qty_required - p_qty
    where id = p_line_id;
  elsif p_reason = 'wrong_fitment' then
    -- The part does not fit: its remaining need and any reservation are dropped.
    update public.job_card_lines
    set qty_returned = qty_returned + p_qty, qty_required = v_net - p_qty, qty_reserved = 0
    where id = p_line_id;
    if v_bike.variant_id is not null then
      insert into public.part_fitments (part_id, variant_id, source, flagged_count, last_flag_note, last_flagged_at)
      values (v_line.part_id, v_bike.variant_id, 'learned', 1, v_note, now())
      on conflict (part_id, variant_id) do update
      set flagged_count = public.part_fitments.flagged_count + 1,
        last_flag_note = excluded.last_flag_note,
        last_flagged_at = excluded.last_flagged_at;
      v_flagged := true;
    end if;
    update public.job_cards set needs_review_reason = 'wrong_fitment: ' || v_part.sku where id = v_card.id;
  else
    -- issued_by_mistake, damaged: qty_required unchanged, so the need reopens.
    update public.job_card_lines set qty_returned = qty_returned + p_qty where id = p_line_id;
  end if;

  update public.job_card_lines
  set cancelled_at = now(), cancel_reason = p_reason
  where id = p_line_id and cancelled_at is null and qty_required = 0 and qty_issued - qty_returned = 0;

  if p_reason in ('issued_by_mistake', 'damaged') then
    v_allocated := private.allocate_free_stock(v_line.workshop_id, v_line.part_id, p_line_id);
  else
    v_allocated := private.allocate_free_stock(v_line.workshop_id, v_line.part_id);
  end if;
  perform private.refresh_card_completeness(v_card.id);

  v_result := private.card_payload(v_card.id) || jsonb_build_object(
    'line', private.line_payload(p_line_id), 'reason', p_reason, 'qty', p_qty, 'move_id', v_move_id,
    'bin_id', v_bin.id, 'bin_code', v_bin.code, 'bin_on_hand', private.bin_on_hand(v_bin.id, v_line.part_id),
    'flagged_fitment', v_flagged, 'allocated', v_allocated);
  perform private.log_activity(v_line.workshop_id, 'job_card_line', p_line_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_line.workshop_id, array[v_line.part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- record_emergency_buy (store_keeper, SPEC §8.3). The money is already spent, so the buy is
-- always recorded; a card that is not confirmed, a cancelled line or a bike not at the workshop
-- only turns it into a stock buy with a warning.

create function public.record_emergency_buy(
  p_request_id uuid,
  p_line_id uuid,
  p_qty int,
  p_unit_price_paise bigint,
  p_vendor_name text,
  p_reason text,
  p_note text default null,
  p_bill_photo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'record_emergency_buy';
  v_done jsonb;
  v_vendor text := nullif(btrim(coalesce(p_vendor_name, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_path text := nullif(btrim(coalesce(p_bill_photo_path, '')), '');
  v_line public.job_card_lines;
  v_card public.job_cards;
  v_bike public.bikes;
  v_rcv public.bins;
  v_warning text;
  v_n int;
  v_ref bigint;
  v_buy_id uuid;
  v_allocated jsonb;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'line_id', p_line_id, 'qty', p_qty, 'unit_price_paise', p_unit_price_paise, 'vendor_name', p_vendor_name,
    'reason', p_reason, 'note', p_note, 'bill_photo_path', p_bill_photo_path));
  if v_done is not null then
    return v_done;
  end if;

  if p_qty is null or p_qty not between 1 and 50 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;
  if p_unit_price_paise is null or p_unit_price_paise not between 1 and 10000000 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_unit_price_paise'));
  end if;
  if v_vendor is null or char_length(v_vendor) > 100 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_vendor_name'));
  end if;
  if p_reason is null or not (p_reason = any (enum_range(null::public.emergency_reason)::text[])) then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reason'));
  end if;
  if char_length(v_note) > 500 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_note'));
  end if;

  select * into v_line from public.job_card_lines where id = p_line_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('line_id', p_line_id));
  end if;

  perform private.authorize('store_keeper', v_line.workshop_id);

  if v_path is not null then
    if v_path !~ ('^' || v_line.workshop_id::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') then
      perform private.err('VALIDATION', jsonb_build_object('field', 'p_bill_photo_path'));
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'bills' and o.name = v_path) then
      perform private.err('BILL_NOT_FOUND', jsonb_build_object('path', v_path));
    end if;
  end if;

  select * into v_rcv from public.bins where workshop_id = v_line.workshop_id and kind = 'receiving';
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bin_kind', 'receiving'));
  end if;

  perform private.lock_workshop(v_line.workshop_id);

  select * into v_card from public.job_cards where id = v_line.job_card_id for update;
  select * into v_line from public.job_card_lines where id = p_line_id for update;
  select * into v_bike from public.bikes where id = v_card.bike_id;

  v_warning := case
    when v_card.status <> 'confirmed' then 'JOB_CARD_NOT_CONFIRMED'
    when v_line.cancelled_at is not null then 'LINE_CANCELLED'
    when v_bike.status not in ('at_workshop', 'in_repair') then 'BIKE_NOT_ARRIVED'
  end;
  v_n := case when v_warning is null
    then greatest(0, least(p_qty, v_line.qty_required - (v_line.qty_issued - v_line.qty_returned)))
    else 0 end;
  v_ref := private.reference_price(v_line.workshop_id, v_line.part_id);

  insert into public.emergency_buys (
    workshop_id, job_card_line_id, part_id, vendor_name, qty, unit_price_paise, reference_price_paise,
    qty_issued, qty_to_stock, reason, note, bill_photo_path, bought_by
  ) values (
    v_line.workshop_id, p_line_id, v_line.part_id, v_vendor, p_qty, p_unit_price_paise, v_ref,
    v_n, p_qty - v_n, p_reason::public.emergency_reason, v_note, v_path, auth.uid()
  )
  returning id into v_buy_id;

  perform private.post_move(
    v_line.workshop_id, v_line.part_id, 'emergency_in', p_qty, null, v_rcv.id, p_request_id,
    null, null, null, null, v_buy_id);
  if v_n > 0 then
    perform private.post_move(
      v_line.workshop_id, v_line.part_id, 'issue', v_n, v_rcv.id, null, p_request_id,
      null, null, p_line_id, null, v_buy_id);
    -- One UPDATE so the covered <= qty_required CHECK never sees a half state. Unlike
    -- issue_to_job_card this does not consume the reservation; any no longer needed is released.
    update public.job_card_lines
    set qty_issued = qty_issued + v_n,
      qty_reserved = least(qty_reserved, qty_required - (qty_issued - qty_returned + v_n))
    where id = p_line_id;
  end if;

  v_allocated := private.allocate_free_stock(v_line.workshop_id, v_line.part_id);
  perform private.refresh_card_completeness(v_card.id);

  v_result := jsonb_build_object(
    'buy_id', v_buy_id, 'qty', p_qty, 'issued', v_n, 'qty_to_stock', p_qty - v_n, 'warning', v_warning,
    'unit_price_paise', p_unit_price_paise, 'reference_price_paise', v_ref,
    'premium', (p_unit_price_paise - v_ref)::numeric / nullif(v_ref, 0),
    'line', private.line_payload(p_line_id), 'card_code', v_card.code, 'reg_no', v_bike.reg_no,
    'receiving_bin_id', v_rcv.id, 'receiving_on_hand', private.bin_on_hand(v_rcv.id, v_line.part_id),
    'allocated', v_allocated);
  perform private.log_activity(v_line.workshop_id, 'emergency_buy', v_buy_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_line.workshop_id, array[v_line.part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Emergency buys with their premium (SPEC §8.3): (unit_price - reference) / reference as
-- numeric, null when the reference is null or 0.

create view public.v_emergency_buys
with (security_invoker = true)
as
select
  e.id,
  e.workshop_id,
  e.job_card_line_id,
  e.part_id,
  e.vendor_name,
  e.qty,
  e.unit_price_paise,
  e.reference_price_paise,
  (e.unit_price_paise - e.reference_price_paise)::numeric / nullif(e.reference_price_paise, 0) as premium,
  e.qty_issued,
  e.qty_to_stock,
  e.reason,
  e.note,
  e.bill_photo_path,
  e.bought_by,
  e.is_simulated,
  e.created_at
from public.emergency_buys e;

grant select on public.v_emergency_buys to authenticated;

-- ---------------------------------------------------------------------------------------------
-- log_app_error (any authenticated user, SPEC §11.1): exempt from the RPC steps (no idempotency
-- row, lock, activity_log or invariant check). p_ref_request_id is stored only in
-- app_errors.request_id, so a failed request can be retried with the same id.

create function public.log_app_error(
  p_route text,
  p_code text,
  p_message text,
  p_ref_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  v_route text := btrim(coalesce(p_route, ''));
  v_code text := btrim(coalesce(p_code, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_id bigint;
begin
  if auth.uid() is null then
    perform private.err('NOT_AUTHENTICATED');
  end if;
  if v_route = '' or char_length(v_route) > 200 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_route'));
  end if;
  if v_code = '' or char_length(v_code) > 64 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_code'));
  end if;
  if v_message = '' then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_message'));
  end if;

  insert into public.app_errors (user_id, route, code, message, request_id)
  values (auth.uid(), v_route, v_code, left(v_message, 2000), p_ref_request_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function private.line_payload(uuid) from public, anon;
revoke execute on function private.reference_price(uuid, uuid) from public, anon;
revoke execute on function public.issue_to_job_card(uuid, uuid, uuid, int) from public, anon;
revoke execute on function public.fit_badge(uuid) from public, anon;
revoke execute on function public.return_from_job_card(uuid, uuid, int, text, uuid, text) from public, anon;
revoke execute on function public.record_emergency_buy(uuid, uuid, int, bigint, text, text, text, text) from public, anon;
revoke execute on function public.log_app_error(text, text, text, uuid) from public, anon;

grant execute on function public.issue_to_job_card(uuid, uuid, uuid, int) to authenticated;
grant execute on function public.fit_badge(uuid) to authenticated;
grant execute on function public.return_from_job_card(uuid, uuid, int, text, uuid, text) to authenticated;
grant execute on function public.record_emergency_buy(uuid, uuid, int, bigint, text, text, text, text) to authenticated;
grant execute on function public.log_app_error(text, text, text, uuid) to authenticated;
