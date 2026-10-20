-- Job card lifecycle after confirm (SPEC §5.2, §6, §9.3): add_job_card_line, set_line_qty,
-- reallocate_reservation, cancel_job_card, close_job_card, create_job_card, cancel_bike and
-- clear_needs_review. Every mutating RPC follows SPEC §11.1.

-- ---------------------------------------------------------------------------------------------
-- Helpers.

-- Required free-text reason: trimmed, 1..200 chars, else VALIDATION.
create function private.require_reason(p_reason text, p_field text default 'p_reason')
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v is null or char_length(v) > 200 then
    perform private.err('VALIDATION', jsonb_build_object('field', p_field));
  end if;
  return v;
end
$$;

-- Cancels a draft or confirmed card (SPEC §5.2 cancel_job_card). Refuses with
-- ISSUED_PARTS_OUTSTANDING while any line has net_issued > 0. Releases every reservation,
-- cancels all live lines, then re-allocates the released parts FIFO to other bikes.
-- Callers hold the workshop lock and have checked the card's status. Returns the allocation.
create function private.cancel_card(p_card_id uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_card public.job_cards;
  v_issued jsonb;
  v_part uuid;
  v_allocated jsonb := '[]';
begin
  select * into v_card from public.job_cards where id = p_card_id for update;

  select jsonb_agg(jsonb_build_object('line_id', l.id, 'part_id', l.part_id, 'sku', p.sku,
      'net_issued', l.qty_issued - l.qty_returned) order by p.sku)
  into v_issued
  from public.job_card_lines l
  join public.parts p on p.id = l.part_id
  where l.job_card_id = p_card_id and l.qty_issued - l.qty_returned > 0;
  if v_issued is not null then
    perform private.err('ISSUED_PARTS_OUTSTANDING', jsonb_build_object('lines', v_issued));
  end if;

  update public.job_card_lines
  set qty_reserved = 0, cancelled_at = now(), cancel_reason = p_reason
  where job_card_id = p_card_id and cancelled_at is null;

  update public.job_cards
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, parts_complete_at = null
  where id = p_card_id;

  foreach v_part in array private.card_part_ids(p_card_id) loop
    v_allocated := v_allocated || private.allocate_free_stock(v_card.workshop_id, v_part);
  end loop;
  return v_allocated;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- add_job_card_line (SPEC §5.2): confirmed cards. Manager adds a manual line (and clears
-- needs_review_reason); store keeper adds an extra line with a required reason. Adding a part
-- already on the card increases qty_required. Allocates immediately.

create function public.add_job_card_line(
  p_request_id uuid,
  p_card_id uuid,
  p_part_id uuid,
  p_qty int,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'add_job_card_line';
  v_done jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_card public.job_cards;
  v_part public.parts;
  v_is_manager boolean;
  v_line public.job_card_lines;
  v_allocated jsonb;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'card_id', p_card_id, 'part_id', p_part_id, 'qty', p_qty, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  if p_qty is null or p_qty not between 1 and 999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;
  if char_length(v_reason) > 200 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reason'));
  end if;

  select * into v_card from public.job_cards where id = p_card_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('card_id', p_card_id));
  end if;

  perform private.authorize('store_keeper', v_card.workshop_id);
  v_is_manager := private.my_role() >= 'manager';
  if not v_is_manager and v_reason is null then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reason'));
  end if;

  select * into v_part from public.parts where id = p_part_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('part_id', p_part_id));
  end if;
  if not v_part.is_active then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_part_id', 'reason', 'part_inactive'));
  end if;

  perform private.lock_workshop(v_card.workshop_id);

  select * into v_card from public.job_cards where id = p_card_id for update;
  if v_card.status <> 'confirmed' then
    perform private.err('JOB_CARD_NOT_CONFIRMED', jsonb_build_object('status', v_card.status));
  end if;

  select * into v_line from public.job_card_lines
  where job_card_id = p_card_id and part_id = p_part_id and cancelled_at is null
  for update;
  if v_line.id is null then
    insert into public.job_card_lines (workshop_id, job_card_id, part_id, qty_required, source, added_reason)
    values (v_card.workshop_id, p_card_id, p_part_id, p_qty,
      case when v_is_manager then 'manual' else 'extra' end::public.line_source, v_reason)
    returning * into v_line;
  else
    update public.job_card_lines set qty_required = qty_required + p_qty
    where id = v_line.id
    returning * into v_line;
  end if;

  if v_is_manager and v_card.needs_review_reason is not null then
    update public.job_cards set needs_review_reason = null where id = p_card_id;
  end if;

  v_allocated := private.allocate_free_stock(v_card.workshop_id, p_part_id, v_line.id);
  perform private.refresh_card_completeness(p_card_id);

  v_result := private.card_payload(p_card_id) || jsonb_build_object(
    'line_id', v_line.id, 'allocated', v_allocated,
    'cleared_needs_review_reason', case when v_is_manager then v_card.needs_review_reason end);
  perform private.log_activity(v_card.workshop_id, 'job_card', p_card_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_card.workshop_id, array[p_part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- set_line_qty (manager, SPEC §5.2): new_qty >= net_issued (RETURN_PARTS_FIRST). A decrease
-- releases the excess reservation to other bikes; an increase allocates to this line first;
-- 0 with nothing issued cancels the line.

create function public.set_line_qty(p_request_id uuid, p_line_id uuid, p_qty int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'set_line_qty';
  v_done jsonb;
  v_reason text;
  v_line public.job_card_lines;
  v_card public.job_cards;
  v_net int;
  v_allocated jsonb;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'line_id', p_line_id, 'qty', p_qty, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  if p_qty is null or p_qty not between 0 and 999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;
  v_reason := private.require_reason(p_reason);

  select * into v_line from public.job_card_lines where id = p_line_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('line_id', p_line_id));
  end if;

  perform private.authorize('manager', v_line.workshop_id);
  perform private.lock_workshop(v_line.workshop_id);

  select * into v_card from public.job_cards where id = v_line.job_card_id for update;
  select * into v_line from public.job_card_lines where id = p_line_id for update;
  if v_card.status <> 'confirmed' then
    perform private.err('JOB_CARD_NOT_CONFIRMED', jsonb_build_object('status', v_card.status));
  end if;
  if v_line.cancelled_at is not null then
    perform private.err('LINE_CANCELLED', jsonb_build_object('line_id', p_line_id));
  end if;

  v_net := v_line.qty_issued - v_line.qty_returned;
  if p_qty < v_net then
    perform private.err('RETURN_PARTS_FIRST', jsonb_build_object('net_issued', v_net, 'qty', p_qty));
  end if;

  if p_qty = 0 then
    -- net_issued is 0 here (checked above).
    update public.job_card_lines
    set qty_required = 0, qty_reserved = 0, cancelled_at = now(), cancel_reason = v_reason
    where id = p_line_id;
    v_allocated := private.allocate_free_stock(v_line.workshop_id, v_line.part_id);
  elsif p_qty < v_line.qty_required then
    update public.job_card_lines
    set qty_required = p_qty, qty_reserved = least(qty_reserved, p_qty - v_net)
    where id = p_line_id;
    v_allocated := private.allocate_free_stock(v_line.workshop_id, v_line.part_id);
  else
    update public.job_card_lines set qty_required = p_qty where id = p_line_id;
    v_allocated := private.allocate_free_stock(v_line.workshop_id, v_line.part_id, p_line_id);
  end if;
  perform private.refresh_card_completeness(v_card.id);

  v_result := private.card_payload(v_card.id) || jsonb_build_object(
    'line_id', p_line_id, 'previous_qty', v_line.qty_required, 'allocated', v_allocated);
  perform private.log_activity(v_line.workshop_id, 'job_card_line', p_line_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_line.workshop_id, array[v_line.part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- reallocate_reservation (manager, SPEC §5.2): moves reserved (never issued) units from one
-- bike's line to another's. Same workshop and part, both cards confirmed, qty within the from
-- line's reservation and the to line's uncovered qty.

create function public.reallocate_reservation(
  p_request_id uuid,
  p_from_line_id uuid,
  p_to_line_id uuid,
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
  c_fn constant text := 'reallocate_reservation';
  v_done jsonb;
  v_reason text;
  v_from public.job_card_lines;
  v_to public.job_card_lines;
  v_from_card public.job_cards;
  v_to_card public.job_cards;
  v_uncovered int;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'from_line_id', p_from_line_id, 'to_line_id', p_to_line_id, 'qty', p_qty, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  if p_qty is null or p_qty not between 1 and 999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;
  v_reason := private.require_reason(p_reason);

  select * into v_from from public.job_card_lines where id = p_from_line_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('line_id', p_from_line_id));
  end if;

  perform private.authorize('manager', v_from.workshop_id);

  -- A line in another workshop is reported exactly like a missing one.
  select * into v_to from public.job_card_lines where id = p_to_line_id and workshop_id = v_from.workshop_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('line_id', p_to_line_id));
  end if;

  perform private.lock_workshop(v_from.workshop_id);

  select * into v_from from public.job_card_lines where id = p_from_line_id for update;
  select * into v_to from public.job_card_lines where id = p_to_line_id for update;
  select * into v_from_card from public.job_cards where id = v_from.job_card_id;
  select * into v_to_card from public.job_cards where id = v_to.job_card_id;

  if v_from.id = v_to.id then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'same_line'));
  end if;
  if v_from.part_id <> v_to.part_id then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'different_parts'));
  end if;
  if v_from_card.status <> 'confirmed' or v_to_card.status <> 'confirmed' then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'card_not_confirmed'));
  end if;
  if v_to.cancelled_at is not null then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'to_line_cancelled'));
  end if;
  v_uncovered := v_to.qty_required - (v_to.qty_reserved + v_to.qty_issued - v_to.qty_returned);
  if p_qty > v_from.qty_reserved or p_qty > v_uncovered then
    perform private.err('VALIDATION', jsonb_build_object(
      'reason', 'qty_exceeds', 'from_reserved', v_from.qty_reserved, 'to_uncovered', v_uncovered));
  end if;

  update public.job_card_lines set qty_reserved = qty_reserved - p_qty where id = p_from_line_id;
  update public.job_card_lines set qty_reserved = qty_reserved + p_qty where id = p_to_line_id;
  perform private.refresh_card_completeness(v_from_card.id);
  perform private.refresh_card_completeness(v_to_card.id);

  v_result := jsonb_build_object(
    'part_id', v_from.part_id, 'qty', p_qty, 'reason', v_reason,
    'from', jsonb_build_object('line_id', p_from_line_id, 'card_code', v_from_card.code,
      'qty_reserved', v_from.qty_reserved - p_qty,
      'parts_complete_at', (select c.parts_complete_at from public.job_cards c where c.id = v_from_card.id)),
    'to', jsonb_build_object('line_id', p_to_line_id, 'card_code', v_to_card.code,
      'qty_reserved', v_to.qty_reserved + p_qty,
      'parts_complete_at', (select c.parts_complete_at from public.job_cards c where c.id = v_to_card.id)));
  perform private.log_activity(v_from.workshop_id, 'job_card_line', p_to_line_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_from.workshop_id, array[v_from.part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- cancel_job_card (manager, SPEC §5.2). POs are never changed automatically.

create function public.cancel_job_card(p_request_id uuid, p_card_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'cancel_job_card';
  v_done jsonb;
  v_reason text;
  v_card public.job_cards;
  v_allocated jsonb;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('card_id', p_card_id, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  v_reason := private.require_reason(p_reason);

  select * into v_card from public.job_cards where id = p_card_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('card_id', p_card_id));
  end if;

  perform private.authorize('manager', v_card.workshop_id);
  perform private.lock_workshop(v_card.workshop_id);

  select * into v_card from public.job_cards where id = p_card_id for update;
  if v_card.status not in ('draft', 'confirmed') then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('from', v_card.status, 'to', 'cancelled'));
  end if;

  v_allocated := private.cancel_card(p_card_id, v_reason);

  v_result := jsonb_build_object('card_id', p_card_id, 'code', v_card.code, 'status', 'cancelled',
    'allocated', v_allocated);
  perform private.log_activity(v_card.workshop_id, 'job_card', p_card_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_card.workshop_id, private.card_part_ids(p_card_id));
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- close_job_card (manager, SPEC §5.2, §9.3): bike must be in_repair. Without drop_remaining
-- every live line must be fully issued with nothing reserved (OPEN_LINES), and
-- needs_review_reason must be clear. With drop_remaining (reason required): release
-- reservations, qty_required = net_issued, cancel lines left at 0, clear needs_review_reason.
-- Then learned fitments, parts_complete_at (if still null), closed_at, bike ready.

create function public.close_job_card(
  p_request_id uuid,
  p_card_id uuid,
  p_drop_remaining boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'close_job_card';
  v_done jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_card public.job_cards;
  v_bike public.bikes;
  v_open jsonb;
  v_part uuid;
  v_parts uuid[];
  v_allocated jsonb := '[]';
  v_learned int;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'card_id', p_card_id, 'drop_remaining', p_drop_remaining, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  if p_drop_remaining is null then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_drop_remaining'));
  end if;
  if p_drop_remaining then
    v_reason := private.require_reason(p_reason);
  elsif char_length(v_reason) > 200 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reason'));
  end if;

  select * into v_card from public.job_cards where id = p_card_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('card_id', p_card_id));
  end if;

  perform private.authorize('manager', v_card.workshop_id);
  perform private.lock_workshop(v_card.workshop_id);

  select * into v_card from public.job_cards where id = p_card_id for update;
  if v_card.status <> 'confirmed' then
    perform private.err('JOB_CARD_NOT_CONFIRMED', jsonb_build_object('status', v_card.status));
  end if;
  select * into v_bike from public.bikes where id = v_card.bike_id for update;
  if v_bike.status <> 'in_repair' then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('from', v_bike.status, 'to', 'ready'));
  end if;

  v_parts := private.card_part_ids(p_card_id);

  if not p_drop_remaining then
    select jsonb_agg(jsonb_build_object('line_id', l.id, 'part_id', l.part_id, 'sku', p.sku,
        'qty_required', l.qty_required, 'qty_reserved', l.qty_reserved,
        'net_issued', l.qty_issued - l.qty_returned) order by p.sku)
    into v_open
    from public.job_card_lines l
    join public.parts p on p.id = l.part_id
    where l.job_card_id = p_card_id and l.cancelled_at is null
      and (l.qty_reserved > 0 or l.qty_issued - l.qty_returned <> l.qty_required);
    if v_open is not null or v_card.needs_review_reason is not null then
      perform private.err('OPEN_LINES', jsonb_build_object(
        'lines', coalesce(v_open, '[]'), 'needs_review_reason', v_card.needs_review_reason));
    end if;
  else
    update public.job_card_lines
    set qty_reserved = 0, qty_required = qty_issued - qty_returned,
      cancelled_at = case when qty_issued - qty_returned = 0 then now() end,
      cancel_reason = case when qty_issued - qty_returned = 0 then v_reason end
    where job_card_id = p_card_id and cancelled_at is null;
  end if;

  -- Learned fitments (SPEC §9.3): a part that was fitted is confirmed for the bike's variant.
  with fitted as (
    select distinct l.part_id
    from public.job_card_lines l
    join public.parts p on p.id = l.part_id
    where l.job_card_id = p_card_id and l.cancelled_at is null
      and l.qty_issued - l.qty_returned > 0 and not p.is_universal and v_bike.variant_id is not null
  ),
  up as (
    insert into public.part_fitments (part_id, variant_id, source, confirmed_count)
    select f.part_id, v_bike.variant_id, 'learned', 1 from fitted f
    on conflict (part_id, variant_id) do update set confirmed_count = public.part_fitments.confirmed_count + 1
    returning 1
  )
  select count(*) into v_learned from up;

  update public.job_cards
  set status = 'closed', closed_at = now(), needs_review_reason = null,
    parts_complete_at = coalesce(parts_complete_at, now())
  where id = p_card_id;
  update public.bikes set status = 'ready', ready_at = now() where id = v_bike.id;

  foreach v_part in array v_parts loop
    v_allocated := v_allocated || private.allocate_free_stock(v_card.workshop_id, v_part);
  end loop;

  v_result := private.card_payload(p_card_id) || jsonb_build_object(
    'drop_remaining', p_drop_remaining, 'learned_fitments', v_learned, 'allocated', v_allocated,
    'cleared_needs_review_reason', v_card.needs_review_reason);
  perform private.log_activity(v_card.workshop_id, 'job_card', p_card_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_card.workshop_id, v_parts);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- create_job_card (manager, SPEC §5.2): returns the bike's open card unchanged, or creates a
-- draft card with suggested lines regenerated from the bike's existing findings (findings are
-- relinked to the new lines; no_part_reason is kept).

create function public.create_job_card(p_request_id uuid, p_bike_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'create_job_card';
  v_done jsonb;
  v_bike public.bikes;
  v_card uuid;
  v_created boolean := false;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('bike_id', p_bike_id));
  if v_done is not null then
    return v_done;
  end if;

  select * into v_bike from public.bikes where id = p_bike_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bike_id', p_bike_id));
  end if;

  perform private.authorize('manager', v_bike.workshop_id);
  perform private.lock_workshop(v_bike.workshop_id);

  select * into v_bike from public.bikes where id = p_bike_id for update;
  if v_bike.status in ('ready', 'cancelled') then
    perform private.err('BIKE_NOT_ACTIVE', jsonb_build_object('bike_status', v_bike.status));
  end if;

  select c.id into v_card from public.job_cards c
  where c.bike_id = p_bike_id and c.status in ('draft', 'confirmed');
  if v_card is null then
    insert into public.job_cards (workshop_id, code, bike_id)
    values (v_bike.workshop_id, private.next_code(v_bike.workshop_id, 'job_card'), p_bike_id)
    returning id into v_card;
    perform private.regenerate_suggested_lines(v_card);
    v_created := true;
  end if;

  v_result := private.card_payload(v_card) || jsonb_build_object('created', v_created);
  perform private.log_activity(v_bike.workshop_id, 'job_card', v_card, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_bike.workshop_id, private.card_part_ids(v_card));
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- cancel_bike (manager, SPEC §5.1, §5.2): not for ready bikes. Cancels the open card first (so
-- it fails while parts are issued), then the bike.

create function public.cancel_bike(p_request_id uuid, p_bike_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'cancel_bike';
  v_done jsonb;
  v_reason text;
  v_bike public.bikes;
  v_card public.job_cards;
  v_allocated jsonb := '[]';
  v_parts uuid[] := '{}';
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('bike_id', p_bike_id, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  v_reason := private.require_reason(p_reason);

  select * into v_bike from public.bikes where id = p_bike_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bike_id', p_bike_id));
  end if;

  perform private.authorize('manager', v_bike.workshop_id);
  perform private.lock_workshop(v_bike.workshop_id);

  select * into v_bike from public.bikes where id = p_bike_id for update;
  if v_bike.status not in ('purchased', 'at_workshop', 'in_repair') then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('from', v_bike.status, 'to', 'cancelled'));
  end if;

  select * into v_card from public.job_cards
  where bike_id = p_bike_id and status in ('draft', 'confirmed')
  for update;
  if v_card.id is not null then
    v_parts := private.card_part_ids(v_card.id);
    v_allocated := private.cancel_card(v_card.id, v_reason);
  end if;

  update public.bikes set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
  where id = p_bike_id;

  v_result := jsonb_build_object('bike_id', p_bike_id, 'reg_no', v_bike.reg_no, 'status', 'cancelled',
    'card_code', v_card.code, 'allocated', v_allocated);
  perform private.log_activity(v_bike.workshop_id, 'bike', p_bike_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_bike.workshop_id, v_parts);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- clear_needs_review (manager, SPEC §8.2): clears needs_review_reason on a confirmed card
-- (activity_log keeps the old value) and recomputes completeness.

create function public.clear_needs_review(p_request_id uuid, p_card_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'clear_needs_review';
  v_done jsonb;
  v_reason text;
  v_card public.job_cards;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('card_id', p_card_id, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  v_reason := private.require_reason(p_reason);

  select * into v_card from public.job_cards where id = p_card_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('card_id', p_card_id));
  end if;

  perform private.authorize('manager', v_card.workshop_id);
  perform private.lock_workshop(v_card.workshop_id);

  select * into v_card from public.job_cards where id = p_card_id for update;
  if v_card.status <> 'confirmed' then
    perform private.err('JOB_CARD_NOT_CONFIRMED', jsonb_build_object('status', v_card.status));
  end if;

  update public.job_cards set needs_review_reason = null where id = p_card_id;
  perform private.refresh_card_completeness(p_card_id);

  v_result := private.card_payload(p_card_id) || jsonb_build_object(
    'cleared_needs_review_reason', v_card.needs_review_reason, 'reason', v_reason);
  perform private.log_activity(v_card.workshop_id, 'job_card', p_card_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_card.workshop_id, private.card_part_ids(p_card_id));
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function private.require_reason(text, text) from public, anon;
revoke execute on function private.cancel_card(uuid, text) from public, anon;
revoke execute on function public.add_job_card_line(uuid, uuid, uuid, int, text) from public, anon;
revoke execute on function public.set_line_qty(uuid, uuid, int, text) from public, anon;
revoke execute on function public.reallocate_reservation(uuid, uuid, uuid, int, text) from public, anon;
revoke execute on function public.cancel_job_card(uuid, uuid, text) from public, anon;
revoke execute on function public.close_job_card(uuid, uuid, boolean, text) from public, anon;
revoke execute on function public.create_job_card(uuid, uuid) from public, anon;
revoke execute on function public.cancel_bike(uuid, uuid, text) from public, anon;
revoke execute on function public.clear_needs_review(uuid, uuid, text) from public, anon;

grant execute on function public.add_job_card_line(uuid, uuid, uuid, int, text) to authenticated;
grant execute on function public.set_line_qty(uuid, uuid, int, text) to authenticated;
grant execute on function public.reallocate_reservation(uuid, uuid, uuid, int, text) to authenticated;
grant execute on function public.cancel_job_card(uuid, uuid, text) to authenticated;
grant execute on function public.close_job_card(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.create_job_card(uuid, uuid) to authenticated;
grant execute on function public.cancel_bike(uuid, uuid, text) to authenticated;
grant execute on function public.clear_needs_review(uuid, uuid, text) to authenticated;
