-- Bikes, inspection findings and draft/confirmed job cards (SPEC §3.2, §5, §9.1): candidate
-- read functions, suggestion helpers, and the RPCs create_bike, set_bike_variant,
-- update_draft_findings, resolve_finding, switch_line_part, confirm_job_card, set_needed_by,
-- mark_arrived and start_repair. Every mutating RPC follows SPEC §11.1.

-- ---------------------------------------------------------------------------------------------
-- Candidate parts (SPEC §9.1). SECURITY INVOKER read functions, so RLS applies to the caller.
-- They are the single source of the ranking: the RPCs below call public.finding_candidates
-- for auto-pick. part_candidates is public (not private) because clients may execute only the
-- SPEC §11.2 private functions, and both wrappers run as the caller.

-- Ranked candidates of one part_type for a variant (null = unknown variant): fitments to the
-- variant (catalogue, or learned with confirmed_count >= 1); if none, active universal parts.
-- auto_pick is false for a fitment with flagged_count >= max(1, confirmed_count).
create function public.part_candidates(p_variant_id uuid, p_part_type text)
returns table (
  part_id uuid,
  sku text,
  name text,
  name_hi text,
  uom public.uom,
  is_universal boolean,
  source public.fitment_source,
  confirmed_count int,
  flagged_count int,
  qty_per_bike int,
  auto_pick boolean,
  rank int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with specific as (
    select p.id, f.source, f.confirmed_count, f.flagged_count, f.qty_per_bike
    from public.parts p
    join public.part_fitments f on f.part_id = p.id and f.variant_id = p_variant_id
    where p.is_active and p.part_type = p_part_type
      and (f.source = 'catalogue' or f.confirmed_count >= 1)
  ),
  universal as (
    select p.id, f.source, f.confirmed_count, f.flagged_count, f.qty_per_bike
    from public.parts p
    left join public.part_fitments f on f.part_id = p.id and f.variant_id = p_variant_id
    where p.is_active and p.part_type = p_part_type and p.is_universal
      and not exists (select 1 from specific)
  ),
  c as (
    select x.id, x.source, coalesce(x.confirmed_count, 0) as confirmed_count,
      coalesce(x.flagged_count, 0) as flagged_count, x.qty_per_bike,
      coalesce(x.flagged_count, 0) < greatest(1, coalesce(x.confirmed_count, 0)) as auto_pick
    from (select * from specific union all select * from universal) x
  ),
  ranked as (
    select p.id, p.sku, p.name, p.name_hi, p.uom, p.is_universal, c.source, c.confirmed_count,
      c.flagged_count, c.qty_per_bike, c.auto_pick,
      row_number() over (
        order by c.auto_pick desc,
          case c.source when 'catalogue' then 0 when 'learned' then 1 else 2 end,
          c.confirmed_count - c.flagged_count desc,
          p.standard_price_paise asc,
          p.sku asc
      )::int as rank
    from c
    join public.parts p on p.id = c.id
  )
  select * from ranked order by rank
$$;

-- Candidates for a finding: the applicable finding_type_parts row (attr_key null, or the bike's
-- attribute matches; unknown variant: only null or segment rows), then part_candidates.
-- qty = finding qty, else the fitment's qty_per_bike, else the mapping qty.
create function public.finding_candidates(p_finding_id uuid)
returns table (
  part_id uuid,
  sku text,
  name text,
  name_hi text,
  uom public.uom,
  is_universal boolean,
  source public.fitment_source,
  confirmed_count int,
  flagged_count int,
  qty_per_bike int,
  auto_pick boolean,
  rank int,
  part_type text,
  qty int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.part_id, c.sku, c.name, c.name_hi, c.uom, c.is_universal, c.source, c.confirmed_count,
    c.flagged_count, c.qty_per_bike, c.auto_pick, c.rank, ftp.part_type,
    coalesce(f.qty, c.qty_per_bike, ftp.qty)
  from public.inspection_findings f
  join public.bikes b on b.id = f.bike_id
  join public.vehicle_models m on m.id = b.model_id
  left join public.model_variants v on v.id = b.variant_id
  join lateral (
    select t.part_type, t.qty
    from public.finding_type_parts t
    where t.finding_type_id = f.finding_type_id
      and (t.attr_key is null or t.attr_value = case t.attr_key
        when 'segment' then m.segment::text
        when 'brake_front' then v.brake_front::text
        when 'brake_rear' then v.brake_rear::text
        when 'start_type' then v.start_type::text
        when 'wheels' then v.wheels::text
        when 'emission' then v.emission::text
        when 'fuel' then v.fuel::text
      end)
    limit 1
  ) ftp on true
  cross join lateral public.part_candidates(b.variant_id, ftp.part_type) c
  where f.id = p_finding_id
  order by c.rank
$$;

-- Candidates of the line part's part_type for the line's bike ("1 of N" switch).
create function public.line_candidates(p_line_id uuid)
returns table (
  part_id uuid,
  sku text,
  name text,
  name_hi text,
  uom public.uom,
  is_universal boolean,
  source public.fitment_source,
  confirmed_count int,
  flagged_count int,
  qty_per_bike int,
  auto_pick boolean,
  rank int,
  is_current boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.part_id, c.sku, c.name, c.name_hi, c.uom, c.is_universal, c.source, c.confirmed_count,
    c.flagged_count, c.qty_per_bike, c.auto_pick, c.rank, c.part_id = l.part_id
  from public.job_card_lines l
  join public.job_cards jc on jc.id = l.job_card_id
  join public.bikes b on b.id = jc.bike_id
  join public.parts lp on lp.id = l.part_id
  cross join lateral public.part_candidates(b.variant_id, lp.part_type) c
  where l.id = p_line_id
  order by c.rank
$$;

-- ---------------------------------------------------------------------------------------------
-- Helpers.

-- Root-creating RPCs (SPEC §11.1 step 2): a non-admin may pass null (= own workshop); admin
-- must pass one. authorize() then rejects anything else.
create function private.root_workshop(p_workshop_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_workshop_id is not null then
    return p_workshop_id;
  end if;
  if private.is_admin() then
    perform private.err('WORKSHOP_REQUIRED');
  end if;
  return private.my_workshop_id();
end
$$;

-- Validates the findings input [{finding_type_id, qty null, notes null}] (VALIDATION, or
-- NOT_FOUND for an unknown or retired finding type).
create function private.parse_findings(p_findings jsonb)
returns table (finding_type_id uuid, qty int, notes text)
language plpgsql
stable
set search_path = ''
as $$
declare
  e jsonb;
  v_qty jsonb;
  v_notes jsonb;
begin
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_findings'));
  end if;

  for e in select x from jsonb_array_elements(p_findings) as x loop
    if jsonb_typeof(e) <> 'object'
       or coalesce(e ->> 'finding_type_id', '') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' then
      perform private.err('VALIDATION', jsonb_build_object('field', 'p_findings', 'reason', 'finding_type_id'));
    end if;
    v_qty := coalesce(e -> 'qty', 'null');
    if jsonb_typeof(v_qty) <> 'null' and (
      jsonb_typeof(v_qty) <> 'number' or v_qty::text::numeric % 1 <> 0 or v_qty::text::numeric not between 1 and 999
    ) then
      perform private.err('VALIDATION', jsonb_build_object('field', 'p_findings', 'reason', 'qty'));
    end if;
    v_notes := coalesce(e -> 'notes', 'null');
    if jsonb_typeof(v_notes) not in ('null', 'string') or char_length(e ->> 'notes') > 500 then
      perform private.err('VALIDATION', jsonb_build_object('field', 'p_findings', 'reason', 'notes'));
    end if;

    finding_type_id := (e ->> 'finding_type_id')::uuid;
    if not exists (
      select 1 from public.finding_types t where t.id = finding_type_id and t.is_active
    ) then
      perform private.err('NOT_FOUND', jsonb_build_object('finding_type_id', finding_type_id));
    end if;
    qty := case when jsonb_typeof(v_qty) = 'number' then v_qty::text::int end;
    notes := nullif(btrim(coalesce(e ->> 'notes', '')), '');
    return next;
  end loop;
end
$$;

-- qty one finding asks of a given part (SPEC §9.1 step 5): finding qty, else the fitment's
-- qty_per_bike, else the applicable mapping row's qty when it maps to that part_type, else 1.
create function private.finding_qty(p_finding_id uuid, p_part_id uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(
    f.qty,
    (select pf.qty_per_bike from public.part_fitments pf
     where pf.part_id = p_part_id and pf.variant_id = b.variant_id),
    (select t.qty
     from public.finding_type_parts t
     join public.parts p on p.id = p_part_id and p.part_type = t.part_type
     where t.finding_type_id = f.finding_type_id
       and (t.attr_key is null or t.attr_value = case t.attr_key
         when 'segment' then m.segment::text
         when 'brake_front' then v.brake_front::text
         when 'brake_rear' then v.brake_rear::text
         when 'start_type' then v.start_type::text
         when 'wheels' then v.wheels::text
         when 'emission' then v.emission::text
         when 'fuel' then v.fuel::text
       end)
     limit 1),
    1)
  from public.inspection_findings f
  join public.bikes b on b.id = f.bike_id
  join public.vehicle_models m on m.id = b.model_id
  left join public.model_variants v on v.id = b.variant_id
  where f.id = p_finding_id
$$;

-- SPEC §9.1 step 6: the sum, over distinct finding types, of the largest qty among the line's
-- findings of that type. Null when no finding links to the line.
create function private.merged_line_qty(p_line_id uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select sum(s.qty)::int
  from (
    select max(private.finding_qty(f.id, l.part_id)) as qty
    from public.inspection_findings f
    join public.job_card_lines l on l.id = f.job_card_line_id
    where f.job_card_line_id = p_line_id
    group by f.finding_type_id
  ) s
$$;

create function private.card_part_ids(p_card_id uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct l.part_id), '{}')
  from public.job_card_lines l
  where l.job_card_id = p_card_id
$$;

-- Removes a draft line that no finding links to any more. A line referenced by an emergency
-- buy or a stock move (FK restrict) is cancelled instead.
create function private.drop_draft_line(p_line_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.emergency_buys e where e.job_card_line_id = p_line_id)
     or exists (select 1 from public.stock_moves m where m.job_card_line_id = p_line_id) then
    update public.job_card_lines
    set cancelled_at = now(), cancel_reason = 'suggestion_removed'
    where id = p_line_id and cancelled_at is null;
  else
    delete from public.job_card_lines where id = p_line_id;
  end if;
end
$$;

-- Rebuilds the suggested lines of a draft card from the bike's findings (SPEC §9.1). Findings
-- on manual lines and findings marked "no part needed" are left alone; manual lines are kept
-- (a suggestion for a part that already has a manual line merges into it, keeping the larger
-- qty). Callers hold the workshop lock.
create function private.regenerate_suggested_lines(p_card_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_card public.job_cards;
  v_line uuid;
  r record;
begin
  select * into v_card from public.job_cards where id = p_card_id;
  if v_card.status is distinct from 'draft' then
    raise exception 'regenerate_suggested_lines: card % is not draft', p_card_id;
  end if;

  -- 1. Unlink every finding that is not on a live manual line of this card.
  update public.inspection_findings f
  set job_card_line_id = null
  where f.bike_id = v_card.bike_id
    and f.job_card_line_id is not null
    and not exists (
      select 1 from public.job_card_lines l
      where l.id = f.job_card_line_id and l.job_card_id = p_card_id
        and l.cancelled_at is null and l.source = 'manual'
    );

  -- 2. Auto-pick a part for every open finding and link it to the live line for that part.
  for r in
    select pick.part_id, array_agg(f.id) as finding_ids
    from public.inspection_findings f
    cross join lateral (
      select c.part_id from public.finding_candidates(f.id) c where c.auto_pick order by c.rank limit 1
    ) pick
    where f.bike_id = v_card.bike_id and f.job_card_line_id is null and f.no_part_reason is null
    group by pick.part_id
  loop
    select l.id into v_line
    from public.job_card_lines l
    where l.job_card_id = p_card_id and l.part_id = r.part_id and l.cancelled_at is null;
    if v_line is null then
      insert into public.job_card_lines (workshop_id, job_card_id, part_id, qty_required, source)
      values (v_card.workshop_id, p_card_id, r.part_id, 1, 'suggested')
      returning id into v_line;
    end if;
    update public.inspection_findings set job_card_line_id = v_line where id = any (r.finding_ids);
  end loop;

  -- 3. Quantities: suggested lines get the merged qty; manual lines never shrink.
  update public.job_card_lines l
  set qty_required = case when l.source = 'suggested' then m.qty else greatest(l.qty_required, m.qty) end
  from (
    select l2.id, private.merged_line_qty(l2.id) as qty
    from public.job_card_lines l2
    where l2.job_card_id = p_card_id and l2.cancelled_at is null
  ) m
  where l.id = m.id and m.qty is not null
    and l.qty_required is distinct from
      case when l.source = 'suggested' then m.qty else greatest(l.qty_required, m.qty) end;

  -- 4. Suggested lines no finding points at any more.
  for r in
    select l.id
    from public.job_card_lines l
    where l.job_card_id = p_card_id and l.source = 'suggested' and l.cancelled_at is null
      and not exists (select 1 from public.inspection_findings f where f.job_card_line_id = l.id)
  loop
    perform private.drop_draft_line(r.id);
  end loop;
end
$$;

-- The bike's findings that block confirmation of this card: no "no part" reason and not on a
-- live line of this card.
create function private.unresolved_findings(p_card_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'finding_id', f.id, 'finding_type_id', f.finding_type_id, 'code', t.code, 'label_en', t.label_en,
      'qty', f.qty, 'notes', f.notes)
    order by f.created_at, f.id), '[]')
  from public.job_cards c
  join public.inspection_findings f on f.bike_id = c.bike_id
  join public.finding_types t on t.id = f.finding_type_id
  where c.id = p_card_id
    and f.no_part_reason is null
    and not exists (
      select 1 from public.job_card_lines l
      where l.id = f.job_card_line_id and l.job_card_id = c.id and l.cancelled_at is null
    )
$$;

-- RPC result for a card: the card, its live lines (with their findings) and unresolved findings.
create function private.card_payload(p_card_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'card_id', c.id, 'code', c.code, 'status', c.status, 'bike_id', c.bike_id, 'reg_no', b.reg_no,
    'bike_status', b.status, 'needed_by', c.needed_by, 'confirmed_at', c.confirmed_at,
    'parts_complete_at', c.parts_complete_at, 'needs_review_reason', c.needs_review_reason,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'line_id', l.id, 'part_id', l.part_id, 'sku', p.sku, 'name', p.name,
          'qty_required', l.qty_required, 'qty_reserved', l.qty_reserved, 'qty_issued', l.qty_issued,
          'qty_returned', l.qty_returned, 'source', l.source, 'status', l.status,
          'finding_ids', coalesce((
            select jsonb_agg(f.id order by f.created_at, f.id)
            from public.inspection_findings f where f.job_card_line_id = l.id), '[]'))
        order by p.sku, l.id)
      from public.job_card_lines l
      join public.parts p on p.id = l.part_id
      where l.job_card_id = c.id and l.cancelled_at is null), '[]'),
    'unresolved_findings', private.unresolved_findings(c.id))
  from public.job_cards c
  join public.bikes b on b.id = c.bike_id
  where c.id = p_card_id
$$;

-- ---------------------------------------------------------------------------------------------
-- create_bike (manager, SPEC §5.2): bike (purchased), findings, draft card with suggested lines.

create function public.create_bike(
  p_request_id uuid,
  p_workshop_id uuid,
  p_reg_no text,
  p_model_id uuid,
  p_mfg_year int,
  p_findings jsonb,
  p_variant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'create_bike';
  v_done jsonb;
  v_reg text := btrim(coalesce(p_reg_no, ''));
  v_ws uuid;
  v_bike uuid;
  v_card uuid;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'workshop_id', p_workshop_id, 'reg_no', p_reg_no, 'model_id', p_model_id, 'mfg_year', p_mfg_year,
    'findings', p_findings, 'variant_id', p_variant_id));
  if v_done is not null then
    return v_done;
  end if;

  if char_length(v_reg) not between 1 and 20 or regexp_replace(v_reg, '[^A-Za-z0-9]', '', 'g') = '' then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reg_no'));
  end if;
  if p_mfg_year is null then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_mfg_year'));
  end if;

  v_ws := private.root_workshop(p_workshop_id);
  perform private.authorize('manager', v_ws);

  if not exists (select 1 from public.vehicle_models m where m.id = p_model_id) then
    perform private.err('NOT_FOUND', jsonb_build_object('model_id', p_model_id));
  end if;
  if p_variant_id is not null and not exists (select 1 from public.model_variants v where v.id = p_variant_id) then
    perform private.err('NOT_FOUND', jsonb_build_object('variant_id', p_variant_id));
  end if;
  perform count(*) from private.parse_findings(p_findings);

  perform private.lock_workshop(v_ws);

  if exists (
    select 1 from public.bikes b
    where b.reg_no_norm = upper(regexp_replace(v_reg, '[^A-Za-z0-9]', '', 'g')) and b.status <> 'cancelled'
  ) then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reg_no', 'reason', 'duplicate_reg_no'));
  end if;

  begin
    insert into public.bikes (workshop_id, reg_no, model_id, variant_id, mfg_year, status, purchased_at)
    values (v_ws, v_reg, p_model_id, p_variant_id, p_mfg_year, 'purchased', now())
    returning id into v_bike;
  exception when unique_violation then
    -- Same reg no created at the same moment in the other workshop (the lock is per workshop).
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_reg_no', 'reason', 'duplicate_reg_no'));
  end;

  insert into public.inspection_findings (workshop_id, bike_id, finding_type_id, qty, notes)
  select v_ws, v_bike, x.finding_type_id, x.qty, x.notes from private.parse_findings(p_findings) x;

  insert into public.job_cards (workshop_id, code, bike_id)
  values (v_ws, private.next_code(v_ws, 'job_card'), v_bike)
  returning id into v_card;

  perform private.regenerate_suggested_lines(v_card);

  v_result := private.card_payload(v_card);
  perform private.log_activity(v_ws, 'bike', v_bike, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_ws, private.card_part_ids(v_card));
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- set_bike_variant (manager): only while the bike's card is draft; regenerates suggested lines.

create function public.set_bike_variant(p_request_id uuid, p_bike_id uuid, p_variant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'set_bike_variant';
  v_done jsonb;
  v_bike public.bikes;
  v_card public.job_cards;
  v_parts uuid[];
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'bike_id', p_bike_id, 'variant_id', p_variant_id));
  if v_done is not null then
    return v_done;
  end if;

  if p_variant_id is null then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_variant_id'));
  end if;

  select * into v_bike from public.bikes where id = p_bike_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('bike_id', p_bike_id));
  end if;

  perform private.authorize('manager', v_bike.workshop_id);
  if not exists (select 1 from public.model_variants v where v.id = p_variant_id) then
    perform private.err('NOT_FOUND', jsonb_build_object('variant_id', p_variant_id));
  end if;

  perform private.lock_workshop(v_bike.workshop_id);

  select * into v_card from public.job_cards
  where bike_id = p_bike_id and status in ('draft', 'confirmed')
  for update;
  if v_card.id is null or v_card.status <> 'draft' then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('reason', 'card_not_draft', 'status', v_card.status));
  end if;

  v_parts := private.card_part_ids(v_card.id);
  update public.bikes set variant_id = p_variant_id where id = p_bike_id;
  perform private.regenerate_suggested_lines(v_card.id);

  v_result := private.card_payload(v_card.id);
  perform private.log_activity(v_bike.workshop_id, 'bike', p_bike_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_bike.workshop_id, v_parts || private.card_part_ids(v_card.id));
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- update_draft_findings (manager): replaces the bike's findings while the card is draft;
-- regenerates suggested lines, keeps manual ones.

create function public.update_draft_findings(p_request_id uuid, p_card_id uuid, p_findings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'update_draft_findings';
  v_done jsonb;
  v_card public.job_cards;
  v_parts uuid[];
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'card_id', p_card_id, 'findings', p_findings));
  if v_done is not null then
    return v_done;
  end if;

  select * into v_card from public.job_cards where id = p_card_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('card_id', p_card_id));
  end if;

  perform private.authorize('manager', v_card.workshop_id);
  perform count(*) from private.parse_findings(p_findings);

  perform private.lock_workshop(v_card.workshop_id);

  select * into v_card from public.job_cards where id = p_card_id for update;
  if v_card.status in ('confirmed', 'closed') then
    perform private.err('FINDINGS_LOCKED', jsonb_build_object('status', v_card.status));
  elsif v_card.status <> 'draft' then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('reason', 'card_not_draft', 'status', v_card.status));
  end if;

  v_parts := private.card_part_ids(p_card_id);
  delete from public.inspection_findings where bike_id = v_card.bike_id;
  insert into public.inspection_findings (workshop_id, bike_id, finding_type_id, qty, notes)
  select v_card.workshop_id, v_card.bike_id, x.finding_type_id, x.qty, x.notes
  from private.parse_findings(p_findings) x;
  perform private.regenerate_suggested_lines(p_card_id);

  v_result := private.card_payload(p_card_id);
  perform private.log_activity(v_card.workshop_id, 'job_card', p_card_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_card.workshop_id, v_parts || private.card_part_ids(p_card_id));
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- resolve_finding (manager): exactly one of a part (creates or merges into a manual line) or a
-- "no part needed" reason. Draft cards only (findings are locked once confirmed).

create function public.resolve_finding(
  p_request_id uuid,
  p_finding_id uuid,
  p_part_id uuid default null,
  p_no_part_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'resolve_finding';
  v_done jsonb;
  v_reason text := nullif(btrim(coalesce(p_no_part_reason, '')), '');
  v_finding public.inspection_findings;
  v_card public.job_cards;
  v_part public.parts;
  v_line public.job_card_lines;
  v_parts uuid[];
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'finding_id', p_finding_id, 'part_id', p_part_id, 'no_part_reason', p_no_part_reason));
  if v_done is not null then
    return v_done;
  end if;

  if (p_part_id is null) = (v_reason is null) then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'part_xor_no_part_reason'));
  end if;
  if char_length(v_reason) > 200 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_no_part_reason'));
  end if;

  select * into v_finding from public.inspection_findings where id = p_finding_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('finding_id', p_finding_id));
  end if;

  perform private.authorize('manager', v_finding.workshop_id);

  if p_part_id is not null then
    select * into v_part from public.parts where id = p_part_id;
    if not found then
      perform private.err('NOT_FOUND', jsonb_build_object('part_id', p_part_id));
    end if;
    if not v_part.is_active then
      perform private.err('VALIDATION', jsonb_build_object('field', 'p_part_id', 'reason', 'part_inactive'));
    end if;
  end if;

  perform private.lock_workshop(v_finding.workshop_id);

  select * into v_card from public.job_cards
  where bike_id = v_finding.bike_id and status in ('draft', 'confirmed')
  for update;
  if v_card.status = 'confirmed' then
    perform private.err('FINDINGS_LOCKED', jsonb_build_object('status', v_card.status));
  elsif v_card.id is null then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('reason', 'no_draft_card'));
  end if;

  v_parts := private.card_part_ids(v_card.id);

  if p_part_id is null then
    update public.inspection_findings
    set no_part_reason = v_reason, job_card_line_id = null
    where id = p_finding_id;
  else
    select * into v_line from public.job_card_lines
    where job_card_id = v_card.id and part_id = p_part_id and cancelled_at is null;
    if v_line.id is null then
      insert into public.job_card_lines (workshop_id, job_card_id, part_id, qty_required, source)
      values (v_card.workshop_id, v_card.id, p_part_id, 0, 'manual')
      returning * into v_line;
    end if;
    update public.inspection_findings
    set job_card_line_id = v_line.id, no_part_reason = null
    where id = p_finding_id;
    update public.job_card_lines
    set source = 'manual', qty_required = greatest(v_line.qty_required, private.merged_line_qty(v_line.id))
    where id = v_line.id;
  end if;

  perform private.regenerate_suggested_lines(v_card.id);

  v_result := private.card_payload(v_card.id);
  perform private.log_activity(v_finding.workshop_id, 'inspection_finding', p_finding_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_finding.workshop_id, v_parts || private.card_part_ids(v_card.id));
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- switch_line_part (manager): draft cards only; the line becomes manual. Switching to a part
-- that already has a live line merges the two.

create function public.switch_line_part(p_request_id uuid, p_line_id uuid, p_part_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'switch_line_part';
  v_done jsonb;
  v_line public.job_card_lines;
  v_card public.job_cards;
  v_part public.parts;
  v_other public.job_card_lines;
  v_parts uuid[];
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'line_id', p_line_id, 'part_id', p_part_id));
  if v_done is not null then
    return v_done;
  end if;

  select * into v_line from public.job_card_lines where id = p_line_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('line_id', p_line_id));
  end if;

  perform private.authorize('manager', v_line.workshop_id);

  select * into v_part from public.parts where id = p_part_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('part_id', p_part_id));
  end if;
  if not v_part.is_active then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_part_id', 'reason', 'part_inactive'));
  end if;

  perform private.lock_workshop(v_line.workshop_id);

  select * into v_card from public.job_cards where id = v_line.job_card_id for update;
  select * into v_line from public.job_card_lines where id = p_line_id for update;
  if v_card.status <> 'draft' then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('reason', 'card_not_draft', 'status', v_card.status));
  end if;
  if v_line.cancelled_at is not null then
    perform private.err('LINE_CANCELLED', jsonb_build_object('line_id', p_line_id));
  end if;

  v_parts := private.card_part_ids(v_card.id);

  if p_part_id = v_line.part_id then
    update public.job_card_lines set source = 'manual' where id = p_line_id;
  else
    select * into v_other from public.job_card_lines
    where job_card_id = v_card.id and part_id = p_part_id and cancelled_at is null;
    if v_other.id is not null then
      update public.inspection_findings set job_card_line_id = v_other.id where job_card_line_id = p_line_id;
      update public.job_card_lines
      set source = 'manual',
        qty_required = greatest(v_other.qty_required, coalesce(private.merged_line_qty(v_other.id), 0))
      where id = v_other.id;
      perform private.drop_draft_line(p_line_id);
    else
      update public.job_card_lines set part_id = p_part_id, source = 'manual' where id = p_line_id;
      update public.job_card_lines
      set qty_required = coalesce(private.merged_line_qty(p_line_id), qty_required)
      where id = p_line_id;
    end if;
  end if;

  v_result := private.card_payload(v_card.id);
  perform private.log_activity(v_line.workshop_id, 'job_card_line', p_line_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_line.workshop_id, v_parts || p_part_id);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- confirm_job_card (manager, SPEC §5.2): refuses while findings are unresolved; defaults
-- needed_by; allocates free stock FIFO for every part on the card.

create function public.confirm_job_card(p_request_id uuid, p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'confirm_job_card';
  v_done jsonb;
  v_card public.job_cards;
  v_bike public.bikes;
  v_unresolved jsonb;
  v_part uuid;
  v_parts uuid[];
  v_allocated jsonb := '[]';
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('card_id', p_card_id));
  if v_done is not null then
    return v_done;
  end if;

  select * into v_card from public.job_cards where id = p_card_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('card_id', p_card_id));
  end if;

  perform private.authorize('manager', v_card.workshop_id);
  perform private.lock_workshop(v_card.workshop_id);

  select * into v_card from public.job_cards where id = p_card_id for update;
  if v_card.status <> 'draft' then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('reason', 'not_draft', 'status', v_card.status));
  end if;
  select * into v_bike from public.bikes where id = v_card.bike_id;
  if v_bike.status not in ('purchased', 'at_workshop', 'in_repair') then
    perform private.err('BIKE_NOT_ACTIVE', jsonb_build_object('bike_status', v_bike.status));
  end if;

  v_unresolved := private.unresolved_findings(p_card_id);
  if jsonb_array_length(v_unresolved) > 0 then
    perform private.err('UNRESOLVED_FINDINGS', jsonb_build_object('findings', v_unresolved));
  end if;

  update public.job_cards
  set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(),
    needed_by = coalesce(needed_by, case
      when v_bike.arrived_at is not null then private.ist_date(v_bike.arrived_at)
      else private.ist_date(v_bike.purchased_at) + 2
    end)
  where id = p_card_id;

  v_parts := private.card_part_ids(p_card_id);
  foreach v_part in array v_parts loop
    v_allocated := v_allocated || private.allocate_free_stock(v_card.workshop_id, v_part);
  end loop;
  perform private.refresh_card_completeness(p_card_id);

  v_result := private.card_payload(p_card_id) || jsonb_build_object('allocated', v_allocated);
  perform private.log_activity(v_card.workshop_id, 'job_card', p_card_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_card.workshop_id, v_parts);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- set_needed_by (manager): affects only future allocations; never takes reservations away.

create function public.set_needed_by(p_request_id uuid, p_card_id uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'set_needed_by';
  v_done jsonb;
  v_card public.job_cards;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('card_id', p_card_id, 'date', p_date));
  if v_done is not null then
    return v_done;
  end if;

  if p_date is null then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_date'));
  end if;

  select * into v_card from public.job_cards where id = p_card_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('card_id', p_card_id));
  end if;

  perform private.authorize('manager', v_card.workshop_id);
  perform private.lock_workshop(v_card.workshop_id);

  select * into v_card from public.job_cards where id = p_card_id for update;
  if v_card.status not in ('draft', 'confirmed') then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('reason', 'card_not_open', 'status', v_card.status));
  end if;

  update public.job_cards set needed_by = p_date where id = p_card_id;

  v_result := jsonb_build_object('card_id', p_card_id, 'code', v_card.code, 'needed_by', p_date,
    'previous_needed_by', v_card.needed_by);
  perform private.log_activity(v_card.workshop_id, 'job_card', p_card_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_card.workshop_id, private.card_part_ids(p_card_id));
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- mark_arrived (store_keeper, SPEC §5.1): purchased -> at_workshop.

create function public.mark_arrived(p_request_id uuid, p_bike_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'mark_arrived';
  v_done jsonb;
  v_bike public.bikes;
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

  perform private.authorize('store_keeper', v_bike.workshop_id);
  perform private.lock_workshop(v_bike.workshop_id);

  select * into v_bike from public.bikes where id = p_bike_id for update;
  if v_bike.status <> 'purchased' then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('from', v_bike.status, 'to', 'at_workshop'));
  end if;

  update public.bikes set status = 'at_workshop', arrived_at = now()
  where id = p_bike_id
  returning * into v_bike;

  v_result := jsonb_build_object('bike_id', p_bike_id, 'reg_no', v_bike.reg_no, 'status', v_bike.status,
    'arrived_at', v_bike.arrived_at);
  perform private.log_activity(v_bike.workshop_id, 'bike', p_bike_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_bike.workshop_id, '{}'::uuid[]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- start_repair (manager, SPEC §5.1): at_workshop -> in_repair; requires a confirmed card.

create function public.start_repair(p_request_id uuid, p_bike_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'start_repair';
  v_done jsonb;
  v_bike public.bikes;
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
  if v_bike.status <> 'at_workshop' then
    perform private.err('INVALID_TRANSITION', jsonb_build_object('from', v_bike.status, 'to', 'in_repair'));
  end if;
  if not exists (select 1 from public.job_cards c where c.bike_id = p_bike_id and c.status = 'confirmed') then
    perform private.err('INVALID_TRANSITION', jsonb_build_object(
      'from', v_bike.status, 'to', 'in_repair', 'reason', 'no_confirmed_job_card'));
  end if;

  update public.bikes set status = 'in_repair', bay_in_at = now()
  where id = p_bike_id
  returning * into v_bike;

  v_result := jsonb_build_object('bike_id', p_bike_id, 'reg_no', v_bike.reg_no, 'status', v_bike.status,
    'bay_in_at', v_bike.bay_in_at);
  perform private.log_activity(v_bike.workshop_id, 'bike', p_bike_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_bike.workshop_id, '{}'::uuid[]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function public.part_candidates(uuid, text) from public, anon;
revoke execute on function public.finding_candidates(uuid) from public, anon;
revoke execute on function public.line_candidates(uuid) from public, anon;
revoke execute on function private.root_workshop(uuid) from public, anon;
revoke execute on function private.parse_findings(jsonb) from public, anon;
revoke execute on function private.finding_qty(uuid, uuid) from public, anon;
revoke execute on function private.merged_line_qty(uuid) from public, anon;
revoke execute on function private.card_part_ids(uuid) from public, anon;
revoke execute on function private.drop_draft_line(uuid) from public, anon;
revoke execute on function private.regenerate_suggested_lines(uuid) from public, anon;
revoke execute on function private.unresolved_findings(uuid) from public, anon;
revoke execute on function private.card_payload(uuid) from public, anon;
revoke execute on function public.create_bike(uuid, uuid, text, uuid, int, jsonb, uuid) from public, anon;
revoke execute on function public.set_bike_variant(uuid, uuid, uuid) from public, anon;
revoke execute on function public.update_draft_findings(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.resolve_finding(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.switch_line_part(uuid, uuid, uuid) from public, anon;
revoke execute on function public.confirm_job_card(uuid, uuid) from public, anon;
revoke execute on function public.set_needed_by(uuid, uuid, date) from public, anon;
revoke execute on function public.mark_arrived(uuid, uuid) from public, anon;
revoke execute on function public.start_repair(uuid, uuid) from public, anon;

grant execute on function public.part_candidates(uuid, text) to authenticated;
grant execute on function public.finding_candidates(uuid) to authenticated;
grant execute on function public.line_candidates(uuid) to authenticated;
grant execute on function public.create_bike(uuid, uuid, text, uuid, int, jsonb, uuid) to authenticated;
grant execute on function public.set_bike_variant(uuid, uuid, uuid) to authenticated;
grant execute on function public.update_draft_findings(uuid, uuid, jsonb) to authenticated;
grant execute on function public.resolve_finding(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.switch_line_part(uuid, uuid, uuid) to authenticated;
grant execute on function public.confirm_job_card(uuid, uuid) to authenticated;
grant execute on function public.set_needed_by(uuid, uuid, date) to authenticated;
grant execute on function public.mark_arrived(uuid, uuid) to authenticated;
grant execute on function public.start_repair(uuid, uuid) to authenticated;
