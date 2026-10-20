-- Purchasing, part A (SPEC §7.1-7.3, §10): the requirement formula private.po_requirements and
-- its read wrapper public.reorder_suggestions; RPCs generate_draft_pos, add_draft_line,
-- update_draft_line, remove_draft_line, send_po and set_po_expected_on. Every mutating RPC
-- follows SPEC §11.1.

-- ---------------------------------------------------------------------------------------------
-- Requirement formula (SPEC §7.1 steps 2-4). The one SQL implementation: generation and the
-- reorder suggestions screen both read it (SPEC §10). Runs as the caller, so through
-- reorder_suggestions RLS limits it to the caller's workshop.
--
-- on_order here counts sent/partially received open_qty plus manual draft lines only; suggested
-- draft lines are what generation is about to recompute, so counting them would make a second
-- run order less. ROP uses integer arithmetic (ceil(net * lead / 28)), so it never drifts on a
-- rounded division; avg_daily_issue_28d is the numeric average for display.
-- enough_history: the workshop's first issue move is at least 7 complete IST days before p_as_of.

create function private.po_requirements(p_workshop_id uuid, p_as_of date)
returns table (
  part_id uuid,
  usable_on_hand int,
  on_order int,
  outstanding_demand int,
  projected int,
  avg_daily_issue_28d numeric,
  lead_time_days int,
  rop int,
  order_qty int,
  effective_supplier_id uuid,
  is_auto boolean,
  enough_history boolean
)
language sql
stable
set search_path = ''
as $$
  with bal as (
    select b.part_id, sum(b.on_hand) as usable_on_hand
    from public.stock_balances b
    join public.bins bn on bn.id = b.bin_id
    where b.workshop_id = p_workshop_id and bn.kind in ('normal', 'receiving')
    group by b.part_id
  ),
  ord as (
    select pl.part_id, sum(pl.open_qty) as on_order
    from public.po_lines pl
    join public.purchase_orders po on po.id = pl.po_id
    where pl.workshop_id = p_workshop_id
      and (po.status in ('sent', 'partially_received') or (po.status = 'draft' and pl.source = 'manual'))
    group by pl.part_id
  ),
  dem as (
    select l.part_id, sum(l.qty_required - (l.qty_issued - l.qty_returned)) as outstanding_demand
    from public.job_card_lines l
    join public.job_cards c on c.id = l.job_card_id
    where l.workshop_id = p_workshop_id and c.status = 'confirmed' and l.cancelled_at is null
    group by l.part_id
  ),
  iss as (
    select m.part_id,
      greatest(0,
        coalesce(sum(m.qty) filter (where m.move_type = 'issue'), 0)
        - coalesce(sum(m.qty) filter (where m.move_type in ('return_to_stock', 'return_to_quarantine')), 0)
      ) as net_issued
    from public.stock_moves m
    where m.workshop_id = p_workshop_id
      and m.move_type in ('issue', 'return_to_stock', 'return_to_quarantine')
      and private.ist_date(m.created_at) between p_as_of - 28 and p_as_of - 1
    group by m.part_id
  ),
  hist as (
    select coalesce(min(private.ist_date(m.created_at)) <= p_as_of - 7, false) as enough
    from public.stock_moves m
    where m.workshop_id = p_workshop_id
      and m.move_type = 'issue'
      and private.ist_date(m.created_at) < p_as_of
  ),
  base as (
    select
      p.id as part_id,
      coalesce(rs.auto, false) and p.category <> 'model_specific' as is_auto,
      coalesce(rs.safety_stock, 0) as safety_stock,
      rs.max_qty,
      coalesce(rs.preferred_supplier_id, p.preferred_supplier_id) as supplier_id,
      coalesce(bal.usable_on_hand, 0)::int as usable_on_hand,
      coalesce(ord.on_order, 0)::int as on_order,
      coalesce(dem.outstanding_demand, 0)::int as outstanding_demand,
      coalesce(iss.net_issued, 0)::int as net_issued
    from public.parts p
    left join public.reorder_settings rs on rs.workshop_id = p_workshop_id and rs.part_id = p.id
    left join bal on bal.part_id = p.id
    left join ord on ord.part_id = p.id
    left join dem on dem.part_id = p.id
    left join iss on iss.part_id = p.id
    where p.is_active and (rs.part_id is not null or coalesce(dem.outstanding_demand, 0) > 0)
  ),
  calc as (
    select
      b.*,
      b.usable_on_hand + b.on_order - b.outstanding_demand as projected,
      coalesce(s.lead_time_days, 0) as lead_time_days,
      h.enough
    from base b
    cross join hist h
    left join public.suppliers s on s.id = b.supplier_id
  ),
  with_rop as (
    select
      c.*,
      case when c.is_auto then
        case when c.enough then ceil((c.net_issued * c.lead_time_days)::numeric / 28)::int else 0 end
          + c.safety_stock
      end as rop
    from calc c
  )
  select
    r.part_id,
    r.usable_on_hand,
    r.on_order,
    r.outstanding_demand,
    r.projected,
    r.net_issued::numeric / 28,
    r.lead_time_days,
    r.rop,
    case
      when not r.is_auto then greatest(0, -r.projected)
      when r.projected <= r.rop then greatest(r.max_qty, r.rop + 1) - r.projected
      else 0
    end,
    r.supplier_id,
    r.is_auto,
    r.enough
  from with_rop r
$$;

-- Reorder suggestions screen (SPEC §10): the same formula, with the part's SKU and name.
create function public.reorder_suggestions(p_workshop_id uuid, p_as_of date default private.ist_today())
returns table (
  part_id uuid,
  sku text,
  name text,
  usable_on_hand int,
  on_order int,
  outstanding_demand int,
  projected int,
  avg_daily_issue_28d numeric,
  lead_time_days int,
  rop int,
  order_qty int,
  effective_supplier_id uuid,
  is_auto boolean,
  enough_history boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select q.part_id, p.sku, p.name, q.usable_on_hand, q.on_order, q.outstanding_demand, q.projected,
    q.avg_daily_issue_28d, q.lead_time_days, q.rop, q.order_qty, q.effective_supplier_id, q.is_auto,
    q.enough_history
  from private.po_requirements(p_workshop_id, p_as_of) q
  join public.parts p on p.id = q.part_id
  order by p.sku
$$;

-- ---------------------------------------------------------------------------------------------
-- Helpers.

-- SPEC §7.3: IST calendar date of sending plus the supplier's lead time.
create function private.expected_on(p_sent_at timestamptz, p_lead int)
returns date
language sql
immutable
set search_path = ''
as $$
  select private.ist_date(p_sent_at) + p_lead
$$;

-- SPEC §7.1 step 5: supplier_parts price ?? last GRN price ?? standard price.
create function private.default_po_price(p_supplier_id uuid, p_part_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select sp.price_paise from public.supplier_parts sp where sp.supplier_id = p_supplier_id and sp.part_id = p_part_id),
    (select lp.unit_price_paise from public.v_part_last_price lp where lp.part_id = p_part_id),
    (select p.standard_price_paise from public.parts p where p.id = p_part_id)
  )
$$;

-- The single draft PO for (workshop, supplier), created with a code if none exists. Callers
-- hold the workshop lock.
create function private.draft_po_for(p_workshop_id uuid, p_supplier_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select po.id into v_id
  from public.purchase_orders po
  where po.workshop_id = p_workshop_id and po.supplier_id = p_supplier_id and po.status = 'draft';
  if v_id is null then
    insert into public.purchase_orders (workshop_id, code, supplier_id)
    values (p_workshop_id, private.next_code(p_workshop_id, 'po'), p_supplier_id)
    returning id into v_id;
  end if;
  return v_id;
end
$$;

-- A PO with its lines, for RPC results.
create function private.po_payload(p_po_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'po_id', po.id,
    'code', po.code,
    'workshop_id', po.workshop_id,
    'supplier_id', po.supplier_id,
    'supplier_name', s.name,
    'status', po.status,
    'sent_at', po.sent_at,
    'expected_on', po.expected_on,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'line_id', pl.id, 'part_id', pl.part_id, 'sku', p.sku, 'qty_ordered', pl.qty_ordered,
          'qty_accepted', pl.qty_accepted, 'qty_cancelled', pl.qty_cancelled, 'open_qty', pl.open_qty,
          'unit_price_paise', pl.unit_price_paise, 'source', pl.source)
        order by p.sku)
      from public.po_lines pl
      join public.parts p on p.id = pl.part_id
      where pl.po_id = po.id
    ), '[]'::jsonb))
  from public.purchase_orders po
  join public.suppliers s on s.id = po.supplier_id
  where po.id = p_po_id
$$;

-- SPEC §7.2 input rules: qty 1..999 (SPEC §13), price null or > 0.
create function private.validate_po_line(p_qty int, p_unit_price_paise bigint)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_qty is null or p_qty not between 1 and 999 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_qty'));
  end if;
  if p_unit_price_paise is not null and p_unit_price_paise <= 0 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_unit_price_paise'));
  end if;
end
$$;

-- Loads a PO line for a draft edit: NOT_FOUND, authorize manager, lock, then VALIDATION if the
-- PO is no longer a draft (sent POs are immutable, SPEC §7.3).
create function private.load_draft_line(p_line_id uuid)
returns public.po_lines
language plpgsql
set search_path = ''
as $$
declare
  v_line public.po_lines;
  v_status public.po_status;
begin
  select * into v_line from public.po_lines where id = p_line_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('line_id', p_line_id));
  end if;

  perform private.authorize('manager', v_line.workshop_id);
  perform private.lock_workshop(v_line.workshop_id);

  select * into v_line from public.po_lines where id = p_line_id for update;
  select po.status into v_status from public.purchase_orders po where po.id = v_line.po_id;
  if v_status <> 'draft' then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'po_not_draft', 'status', v_status));
  end if;
  return v_line;
end
$$;

-- Paise as rupees with two decimals, using integer arithmetic only: 32000 -> '₹320.00'.
create function private.paise_text(p_paise bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select '₹' || (p_paise / 100)::text || '.' || lpad((p_paise % 100)::text, 2, '0')
$$;

-- The WhatsApp message for a PO (SPEC §7.3).
create function private.po_whatsapp_text(p_po_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select concat_ws(E'\n',
    'Purchase order ' || po.code,
    'To: ' || s.name,
    'From: Vutto ' || w.name,
    'Expected by: ' || to_char(po.expected_on, 'DD Mon YYYY'),
    'Prices are per unit, incl. GST.',
    '',
    (
      select string_agg(
        concat_ws(E'\n',
          x.n || '. ' || p.sku || ' ' || p.name,
          '   OEM part no: ' || p.oem_part_no,
          '   Supplier code: ' || sp.supplier_code,
          '   Qty: ' || pl.qty_ordered || ' ' || p.uom::text || ' @ ' || private.paise_text(pl.unit_price_paise) || ' incl. GST',
          case when p.category = 'model_specific' then (
            select string_agg(
              '   Fits: ' || m.make || ' ' || m.model || ' ' || v.name || ' ' || v.year_from
                || '–' || coalesce(v.year_to::text, 'present') || ', ' || v.brake_front::text || ', ' || v.start_type::text,
              E'\n' order by m.make, m.model, v.name, v.year_from)
            from public.part_fitments f
            join public.model_variants v on v.id = f.variant_id
            join public.vehicle_models m on m.id = v.model_id
            where f.part_id = p.id and (f.source = 'catalogue' or f.confirmed_count >= 1)
          ) end),
        E'\n' order by x.n)
      from (
        select pl0.id, row_number() over (order by p0.sku) as n
        from public.po_lines pl0
        join public.parts p0 on p0.id = pl0.part_id
        where pl0.po_id = po.id
      ) x
      join public.po_lines pl on pl.id = x.id
      join public.parts p on p.id = pl.part_id
      left join public.supplier_parts sp on sp.supplier_id = po.supplier_id and sp.part_id = pl.part_id
    ))
  from public.purchase_orders po
  join public.suppliers s on s.id = po.supplier_id
  join public.workshops w on w.id = po.workshop_id
  where po.id = p_po_id
$$;

-- ---------------------------------------------------------------------------------------------
-- generate_draft_pos (manager, SPEC §7.1). Idempotent: computes the target set first, then
-- inserts missing lines, updates only lines whose qty or price differ, and finally deletes
-- suggested lines outside the target set and drafts left empty. Manual lines are never touched.

create function public.generate_draft_pos(p_request_id uuid, p_workshop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'generate_draft_pos';
  v_done jsonb;
  v_ws uuid;
  v_added int := 0;
  v_changed int := 0;
  v_removed int := 0;
  v_unsourced jsonb := '[]';
  v_t_supplier uuid[] := '{}';
  v_t_part uuid[] := '{}';
  v_parts uuid[] := '{}';
  v_removed_parts uuid[];
  v_po uuid;
  v_price bigint;
  v_line public.po_lines;
  v_drafts jsonb;
  v_summary jsonb;
  v_result jsonb;
  r record;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('workshop_id', p_workshop_id));
  if v_done is not null then
    return v_done;
  end if;

  v_ws := private.root_workshop(p_workshop_id);
  perform private.authorize('manager', v_ws);
  perform private.lock_workshop(v_ws);

  -- Steps 1-4: the target set, read once.
  for r in
    select q.part_id, q.order_qty, q.effective_supplier_id as supplier_id, p.sku, p.name
    from private.po_requirements(v_ws, private.ist_today()) q
    join public.parts p on p.id = q.part_id
    where q.order_qty > 0
    order by p.sku
  loop
    if r.supplier_id is null then
      v_unsourced := v_unsourced || jsonb_build_array(jsonb_build_object(
        'part_id', r.part_id, 'sku', r.sku, 'name', r.name, 'qty', r.order_qty));
      continue;
    end if;

    -- Step 5: a manual line on this supplier's draft wins.
    continue when exists (
      select 1
      from public.po_lines pl
      join public.purchase_orders po on po.id = pl.po_id
      where po.workshop_id = v_ws and po.status = 'draft' and po.supplier_id = r.supplier_id
        and pl.part_id = r.part_id and pl.source = 'manual'
    );

    v_t_supplier := v_t_supplier || r.supplier_id;
    v_t_part := v_t_part || r.part_id;
    v_po := private.draft_po_for(v_ws, r.supplier_id);
    v_price := private.default_po_price(r.supplier_id, r.part_id);

    select * into v_line from public.po_lines where po_id = v_po and part_id = r.part_id for update;
    if not found then
      insert into public.po_lines (workshop_id, po_id, part_id, qty_ordered, unit_price_paise, source)
      values (v_ws, v_po, r.part_id, r.order_qty, v_price, 'suggested');
      v_added := v_added + 1;
      v_parts := v_parts || r.part_id;
    elsif v_line.qty_ordered <> r.order_qty or v_line.unit_price_paise is distinct from v_price then
      update public.po_lines set qty_ordered = r.order_qty, unit_price_paise = v_price where id = v_line.id;
      v_changed := v_changed + 1;
      v_parts := v_parts || r.part_id;
    end if;
  end loop;

  -- Step 6: suggested lines no longer in the target set, then drafts left with no lines.
  with gone as (
    delete from public.po_lines pl
    using public.purchase_orders po
    where po.id = pl.po_id
      and po.workshop_id = v_ws
      and po.status = 'draft'
      and pl.source = 'suggested'
      and not exists (
        select 1 from unnest(v_t_supplier, v_t_part) as t (supplier_id, part_id)
        where t.supplier_id = po.supplier_id and t.part_id = pl.part_id
      )
    returning pl.part_id
  )
  select coalesce(array_agg(gone.part_id), '{}') into v_removed_parts from gone;
  v_removed := cardinality(v_removed_parts);
  v_parts := v_parts || v_removed_parts;

  delete from public.purchase_orders po
  where po.workshop_id = v_ws
    and po.status = 'draft'
    and not exists (select 1 from public.po_lines pl where pl.po_id = po.id);

  select coalesce(jsonb_agg(private.po_payload(po.id) order by po.code), '[]') into v_drafts
  from public.purchase_orders po
  where po.workshop_id = v_ws and po.status = 'draft';

  v_summary := jsonb_build_object(
    'workshop_id', v_ws, 'added', v_added, 'changed', v_changed, 'removed', v_removed, 'unsourced', v_unsourced);
  v_result := v_summary || jsonb_build_object('drafts', v_drafts);
  perform private.log_activity(v_ws, 'workshop', v_ws, c_fn, v_summary, p_request_id);
  perform private.assert_invariants(v_ws, v_parts);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Draft edits (manager, SPEC §7.2). Any edit makes the line manual.

create function public.add_draft_line(
  p_request_id uuid,
  p_workshop_id uuid,
  p_supplier_id uuid,
  p_part_id uuid,
  p_qty int,
  p_unit_price_paise bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'add_draft_line';
  v_done jsonb;
  v_ws uuid;
  v_po uuid;
  v_line_id uuid;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'workshop_id', p_workshop_id, 'supplier_id', p_supplier_id, 'part_id', p_part_id, 'qty', p_qty,
    'unit_price_paise', p_unit_price_paise));
  if v_done is not null then
    return v_done;
  end if;

  perform private.validate_po_line(p_qty, p_unit_price_paise);

  v_ws := private.root_workshop(p_workshop_id);
  perform private.authorize('manager', v_ws);

  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id) then
    perform private.err('NOT_FOUND', jsonb_build_object('supplier_id', p_supplier_id));
  end if;
  perform private.require_part(p_part_id);

  perform private.lock_workshop(v_ws);

  v_po := private.draft_po_for(v_ws, p_supplier_id);
  if exists (select 1 from public.po_lines pl where pl.po_id = v_po and pl.part_id = p_part_id) then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_part_id', 'reason', 'already_on_po'));
  end if;

  insert into public.po_lines (workshop_id, po_id, part_id, qty_ordered, unit_price_paise, source)
  values (v_ws, v_po, p_part_id, p_qty, p_unit_price_paise, 'manual')
  returning id into v_line_id;

  v_result := private.po_payload(v_po) || jsonb_build_object('line_id', v_line_id);
  perform private.log_activity(v_ws, 'purchase_order', v_po, c_fn, jsonb_build_object(
    'line_id', v_line_id, 'part_id', p_part_id, 'qty', p_qty, 'unit_price_paise', p_unit_price_paise), p_request_id);
  perform private.assert_invariants(v_ws, array[p_part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

create function public.update_draft_line(p_request_id uuid, p_line_id uuid, p_qty int, p_unit_price_paise bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'update_draft_line';
  v_done jsonb;
  v_line public.po_lines;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'line_id', p_line_id, 'qty', p_qty, 'unit_price_paise', p_unit_price_paise));
  if v_done is not null then
    return v_done;
  end if;

  perform private.validate_po_line(p_qty, p_unit_price_paise);
  v_line := private.load_draft_line(p_line_id);

  update public.po_lines
  set qty_ordered = p_qty, unit_price_paise = p_unit_price_paise, source = 'manual'
  where id = p_line_id;

  v_result := private.po_payload(v_line.po_id) || jsonb_build_object('line_id', p_line_id);
  perform private.log_activity(v_line.workshop_id, 'purchase_order', v_line.po_id, c_fn, jsonb_build_object(
    'line_id', p_line_id, 'part_id', v_line.part_id,
    'old_qty', v_line.qty_ordered, 'qty', p_qty,
    'old_unit_price_paise', v_line.unit_price_paise, 'unit_price_paise', p_unit_price_paise), p_request_id);
  perform private.assert_invariants(v_line.workshop_id, array[v_line.part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- Deletes the line; the draft stays (possibly empty) until it is sent or regeneration removes it.
create function public.remove_draft_line(p_request_id uuid, p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'remove_draft_line';
  v_done jsonb;
  v_line public.po_lines;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('line_id', p_line_id));
  if v_done is not null then
    return v_done;
  end if;

  v_line := private.load_draft_line(p_line_id);
  delete from public.po_lines where id = p_line_id;

  v_result := private.po_payload(v_line.po_id) || jsonb_build_object('removed_line_id', p_line_id);
  perform private.log_activity(v_line.workshop_id, 'purchase_order', v_line.po_id, c_fn, jsonb_build_object(
    'line_id', p_line_id, 'part_id', v_line.part_id, 'qty', v_line.qty_ordered, 'source', v_line.source), p_request_id);
  perform private.assert_invariants(v_line.workshop_id, array[v_line.part_id]);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- send_po (manager, SPEC §7.3).

create function public.send_po(p_request_id uuid, p_po_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'send_po';
  v_done jsonb;
  v_po public.purchase_orders;
  v_missing jsonb;
  v_parts uuid[];
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('po_id', p_po_id));
  if v_done is not null then
    return v_done;
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('po_id', p_po_id));
  end if;

  perform private.authorize('manager', v_po.workshop_id);
  perform private.lock_workshop(v_po.workshop_id);

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.status <> 'draft' then
    perform private.err('PO_NOT_SENDABLE', jsonb_build_object('reason', 'not_draft', 'status', v_po.status));
  end if;

  select array_agg(pl.part_id) into v_parts from public.po_lines pl where pl.po_id = p_po_id;
  if v_parts is null then
    perform private.err('PO_NOT_SENDABLE', jsonb_build_object('reason', 'no_lines'));
  end if;

  select jsonb_agg(p.sku order by p.sku) into v_missing
  from public.po_lines pl
  join public.parts p on p.id = pl.part_id
  where pl.po_id = p_po_id and pl.unit_price_paise is null;
  if v_missing is not null then
    perform private.err('PO_NOT_SENDABLE', jsonb_build_object('reason', 'missing_price', 'parts', v_missing));
  end if;

  update public.purchase_orders po
  set status = 'sent',
      sent_at = now(),
      expected_on = private.expected_on(now(), s.lead_time_days)
  from public.suppliers s
  where po.id = p_po_id and s.id = po.supplier_id;

  v_result := jsonb_build_object(
    'po', private.po_payload(p_po_id),
    'whatsapp_text', private.po_whatsapp_text(p_po_id));
  perform private.log_activity(v_po.workshop_id, 'purchase_order', p_po_id, c_fn, v_result->'po', p_request_id);
  perform private.assert_invariants(v_po.workshop_id, v_parts);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- set_po_expected_on (manager, SPEC §7.3): the only change allowed on a sent PO.
create function public.set_po_expected_on(p_request_id uuid, p_po_id uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'set_po_expected_on';
  v_done jsonb;
  v_po public.purchase_orders;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('po_id', p_po_id, 'date', p_date));
  if v_done is not null then
    return v_done;
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('po_id', p_po_id));
  end if;

  perform private.authorize('manager', v_po.workshop_id);
  perform private.lock_workshop(v_po.workshop_id);

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.status not in ('sent', 'partially_received') then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'po_not_open', 'status', v_po.status));
  end if;
  if p_date is null or p_date < private.ist_today() then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_date'));
  end if;

  update public.purchase_orders set expected_on = p_date where id = p_po_id;

  v_result := private.po_payload(p_po_id);
  perform private.log_activity(v_po.workshop_id, 'purchase_order', p_po_id, c_fn, jsonb_build_object(
    'old_expected_on', v_po.expected_on, 'expected_on', p_date), p_request_id);
  perform private.assert_invariants(v_po.workshop_id, '{}');
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function private.po_requirements(uuid, date) from public, anon;
revoke execute on function public.reorder_suggestions(uuid, date) from public, anon;
revoke execute on function private.expected_on(timestamptz, int) from public, anon;
revoke execute on function private.default_po_price(uuid, uuid) from public, anon;
revoke execute on function private.draft_po_for(uuid, uuid) from public, anon;
revoke execute on function private.po_payload(uuid) from public, anon;
revoke execute on function private.validate_po_line(int, bigint) from public, anon;
revoke execute on function private.load_draft_line(uuid) from public, anon;
revoke execute on function private.paise_text(bigint) from public, anon;
revoke execute on function private.po_whatsapp_text(uuid) from public, anon;
revoke execute on function public.generate_draft_pos(uuid, uuid) from public, anon;
revoke execute on function public.add_draft_line(uuid, uuid, uuid, uuid, int, bigint) from public, anon;
revoke execute on function public.update_draft_line(uuid, uuid, int, bigint) from public, anon;
revoke execute on function public.remove_draft_line(uuid, uuid) from public, anon;
revoke execute on function public.send_po(uuid, uuid) from public, anon;
revoke execute on function public.set_po_expected_on(uuid, uuid, date) from public, anon;

grant execute on function private.po_requirements(uuid, date) to authenticated;
grant execute on function public.reorder_suggestions(uuid, date) to authenticated;
grant execute on function public.generate_draft_pos(uuid, uuid) to authenticated;
grant execute on function public.add_draft_line(uuid, uuid, uuid, uuid, int, bigint) to authenticated;
grant execute on function public.update_draft_line(uuid, uuid, int, bigint) to authenticated;
grant execute on function public.remove_draft_line(uuid, uuid) to authenticated;
grant execute on function public.send_po(uuid, uuid) to authenticated;
grant execute on function public.set_po_expected_on(uuid, uuid, date) to authenticated;
