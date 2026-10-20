-- Purchasing, part B (SPEC §7.4-7.7): private.refresh_po_status; RPCs receive_grn, short_close_po
-- and cancel_po; views v_line_eta and v_excess_on_order. Every mutating RPC follows SPEC §11.1.

-- ---------------------------------------------------------------------------------------------
-- po_requirements: same formula as before; the row set now also includes parts with something on
-- order, so v_excess_on_order sees supply left over after demand disappeared (a cancelled card).
-- Those rows always have order_qty 0 (no demand, no settings: projected >= 0, on-demand), so
-- generation is unchanged.

create or replace function private.po_requirements(p_workshop_id uuid, p_as_of date)
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
    where (p.is_active and (rs.part_id is not null or coalesce(dem.outstanding_demand, 0) > 0))
      or coalesce(ord.on_order, 0) > 0
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

-- ---------------------------------------------------------------------------------------------
-- PO status (SPEC §7.5): the only writer of status for non-draft POs. With A = sum(qty_accepted)
-- and O = sum(open_qty): O = 0 and A = 0 -> cancelled; O = 0 and every line fully accepted ->
-- received; O = 0 otherwise -> closed; O > 0 and A > 0 -> partially_received; else sent.

create function private.refresh_po_status(p_po_id uuid)
returns public.po_status
language plpgsql
set search_path = ''
as $$
declare
  v_old public.po_status;
  v_new public.po_status;
begin
  select po.status into v_old from public.purchase_orders po where po.id = p_po_id;
  if v_old is null or v_old = 'draft' then
    return v_old;
  end if;

  select case
      when sum(pl.open_qty) = 0 and sum(pl.qty_accepted) = 0 then 'cancelled'
      when sum(pl.open_qty) = 0 and bool_and(pl.qty_accepted = pl.qty_ordered) then 'received'
      when sum(pl.open_qty) = 0 then 'closed'
      when sum(pl.qty_accepted) > 0 then 'partially_received'
      else 'sent'
    end::public.po_status
  into v_new
  from public.po_lines pl
  where pl.po_id = p_po_id;

  if v_new is distinct from v_old then
    update public.purchase_orders set status = v_new where id = p_po_id;
  end if;
  return v_new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Helpers.

-- Indian financial year (April-March) of a date, named by its starting year.
create function private.indian_fy(p_date date)
returns int
language sql
immutable
set search_path = ''
as $$
  select extract(year from p_date)::int - case when extract(month from p_date) < 4 then 1 else 0 end
$$;

-- A whole-number quantity from a GRN input line: missing or null = 0, else 0..p_max.
create function private.grn_qty(p_line jsonb, p_key text, p_max int)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := coalesce(p_line -> p_key, 'null');
begin
  if jsonb_typeof(v) = 'null' then
    return 0;
  end if;
  if jsonb_typeof(v) <> 'number' or v::text::numeric % 1 <> 0 or v::text::numeric not between 0 and p_max then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_lines', 'reason', p_key));
  end if;
  return v::text::int;
end
$$;

-- A GRN with its lines and the PO price per line. price_variance: the invoice price differs from
-- the PO price by 5% or more (SPEC §7.4; shown, never blocking). Integer arithmetic only.
create function private.grn_payload(p_grn_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'grn_id', g.id,
    'code', g.code,
    'workshop_id', g.workshop_id,
    'po_id', g.po_id,
    'po_code', po.code,
    'po_status', po.status,
    'supplier_id', g.supplier_id,
    'supplier_invoice_no', g.supplier_invoice_no,
    'invoice_date', g.invoice_date,
    'received_by', g.received_by,
    'received_at', g.received_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'grn_line_id', gl.id, 'po_line_id', gl.po_line_id, 'part_id', gl.part_id, 'sku', p.sku,
          'qty_received', gl.qty_received, 'qty_accepted', gl.qty_accepted, 'qty_damaged', gl.qty_damaged,
          'qty_wrong_part', gl.qty_wrong_part, 'unit_price_paise', gl.unit_price_paise,
          'po_unit_price_paise', pl.unit_price_paise,
          'price_variance', pl.unit_price_paise is not null
            and abs(gl.unit_price_paise - pl.unit_price_paise) * 100 >= 5 * pl.unit_price_paise,
          'open_qty', pl.open_qty)
        order by p.sku)
      from public.grn_lines gl
      join public.po_lines pl on pl.id = gl.po_line_id
      join public.parts p on p.id = gl.part_id
      where gl.grn_id = g.id
    ), '[]'::jsonb))
  from public.grns g
  join public.purchase_orders po on po.id = g.po_id
  where g.id = p_grn_id
$$;

-- ---------------------------------------------------------------------------------------------
-- receive_grn (store_keeper, SPEC §7.4). All input lines are validated (including OVER_RECEIPT)
-- before anything is written, so a refused GRN posts nothing.

create function public.receive_grn(
  p_request_id uuid,
  p_po_id uuid,
  p_supplier_invoice_no text,
  p_invoice_date date,
  p_allow_duplicate_invoice boolean,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'receive_grn';
  v_done jsonb;
  v_invoice text := btrim(coalesce(p_supplier_invoice_no, ''));
  v_po public.purchase_orders;
  v_pl public.po_lines;
  v_sku text;
  e jsonb;
  v_price_in jsonb;
  v_seen uuid[] := '{}';
  v_line_id uuid;
  v_received int;
  v_damaged int;
  v_wrong int;
  v_accepted int;
  v_price bigint;
  v_valid jsonb := '[]';
  v_dup record;
  v_rcv uuid;
  v_grn uuid;
  v_grn_line uuid;
  v_parts uuid[] := '{}';
  v_part uuid;
  v_alloc jsonb := '[]';
  v_allocations jsonb;
  v_result jsonb;
  r record;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'po_id', p_po_id, 'supplier_invoice_no', p_supplier_invoice_no, 'invoice_date', p_invoice_date,
    'allow_duplicate_invoice', p_allow_duplicate_invoice, 'lines', p_lines));
  if v_done is not null then
    return v_done;
  end if;

  if char_length(v_invoice) not between 1 and 40 or regexp_replace(v_invoice, '[^A-Za-z0-9]', '', 'g') = '' then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_supplier_invoice_no'));
  end if;
  if p_invoice_date is null or p_invoice_date > private.ist_today() then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_invoice_date'));
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_lines'));
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('po_id', p_po_id));
  end if;

  perform private.authorize('store_keeper', v_po.workshop_id);
  perform private.lock_workshop(v_po.workshop_id);

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.status not in ('sent', 'partially_received') then
    perform private.err('PO_NOT_RECEIVABLE', jsonb_build_object('status', v_po.status));
  end if;

  -- Validate every line first.
  for e in select x from jsonb_array_elements(p_lines) as x loop
    if jsonb_typeof(e) <> 'object'
       or coalesce(e ->> 'po_line_id', '') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' then
      perform private.err('VALIDATION', jsonb_build_object('field', 'p_lines', 'reason', 'po_line_id'));
    end if;
    v_line_id := (e ->> 'po_line_id')::uuid;

    select * into v_pl from public.po_lines where id = v_line_id and po_id = p_po_id for update;
    if not found then
      perform private.err('VALIDATION', jsonb_build_object(
        'field', 'p_lines', 'reason', 'po_line_not_on_po', 'po_line_id', v_line_id));
    end if;
    if v_line_id = any (v_seen) then
      perform private.err('VALIDATION', jsonb_build_object(
        'field', 'p_lines', 'reason', 'repeated_po_line', 'po_line_id', v_line_id));
    end if;
    v_seen := v_seen || v_line_id;

    v_received := private.grn_qty(e, 'qty_received', 999);
    v_damaged := private.grn_qty(e, 'qty_damaged', 999);
    v_wrong := private.grn_qty(e, 'qty_wrong_part', 999);
    v_accepted := v_received - v_damaged - v_wrong;
    if v_accepted < 0 then
      perform private.err('VALIDATION', jsonb_build_object(
        'field', 'p_lines', 'reason', 'rejected_exceeds_received', 'po_line_id', v_line_id));
    end if;
    continue when v_received = 0;

    -- The invoice price wins; the PO price prefills it.
    v_price_in := coalesce(e -> 'unit_price_paise', 'null');
    if jsonb_typeof(v_price_in) = 'null' then
      v_price := v_pl.unit_price_paise;
    elsif jsonb_typeof(v_price_in) <> 'number' or v_price_in::text::numeric % 1 <> 0
          or v_price_in::text::numeric not between 1 and 999999999 then
      perform private.err('VALIDATION', jsonb_build_object(
        'field', 'p_lines', 'reason', 'unit_price_paise', 'po_line_id', v_line_id));
    else
      v_price := v_price_in::text::bigint;
    end if;
    if v_price is null then
      perform private.err('VALIDATION', jsonb_build_object(
        'field', 'p_lines', 'reason', 'unit_price_paise', 'po_line_id', v_line_id));
    end if;

    if v_accepted > v_pl.open_qty then
      select p.sku into v_sku from public.parts p where p.id = v_pl.part_id;
      perform private.err('OVER_RECEIPT', jsonb_build_object(
        'part', v_sku, 'po_line_id', v_line_id, 'ordered', v_pl.qty_ordered,
        'accepted_so_far', v_pl.qty_accepted, 'max_now', v_pl.open_qty));
    end if;

    v_valid := v_valid || jsonb_build_array(jsonb_build_object(
      'po_line_id', v_line_id, 'part_id', v_pl.part_id, 'qty_received', v_received,
      'qty_accepted', v_accepted, 'qty_damaged', v_damaged, 'qty_wrong_part', v_wrong,
      'unit_price_paise', v_price));
  end loop;

  if jsonb_array_length(v_valid) = 0 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_lines', 'reason', 'nothing_received'));
  end if;

  -- Same supplier, same normalised invoice number, same Indian financial year.
  select g.code, g.received_by, g.received_at, g.invoice_date, pr.full_name
  into v_dup
  from public.grns g
  left join public.profiles pr on pr.user_id = g.received_by
  where g.supplier_id = v_po.supplier_id
    and g.invoice_no_norm = upper(regexp_replace(v_invoice, '[^A-Za-z0-9]', '', 'g'))
    and private.indian_fy(g.invoice_date) = private.indian_fy(p_invoice_date)
  order by g.received_at
  limit 1;
  if found and not coalesce(p_allow_duplicate_invoice, false) then
    perform private.err('DUPLICATE_INVOICE', jsonb_build_object(
      'grn_code', v_dup.code, 'received_by', v_dup.received_by, 'received_by_name', v_dup.full_name,
      'received_at', v_dup.received_at, 'invoice_date', v_dup.invoice_date));
  end if;

  select b.id into v_rcv from public.bins b where b.workshop_id = v_po.workshop_id and b.kind = 'receiving';
  if v_rcv is null then
    perform private.err('NOT_FOUND', jsonb_build_object('bin', 'receiving', 'workshop_id', v_po.workshop_id));
  end if;

  insert into public.grns (workshop_id, code, po_id, supplier_id, supplier_invoice_no, invoice_date, received_by)
  values (v_po.workshop_id, private.next_code(v_po.workshop_id, 'grn'), p_po_id, v_po.supplier_id, v_invoice,
    p_invoice_date, auth.uid())
  returning id into v_grn;

  for r in
    select * from jsonb_to_recordset(v_valid) as x (
      po_line_id uuid, part_id uuid, qty_received int, qty_accepted int, qty_damaged int, qty_wrong_part int,
      unit_price_paise bigint)
  loop
    insert into public.grn_lines (
      workshop_id, grn_id, po_line_id, part_id, qty_received, qty_accepted, qty_damaged, qty_wrong_part, unit_price_paise
    ) values (
      v_po.workshop_id, v_grn, r.po_line_id, r.part_id, r.qty_received, r.qty_accepted, r.qty_damaged,
      r.qty_wrong_part, r.unit_price_paise
    )
    returning id into v_grn_line;

    update public.po_lines
    set qty_accepted = qty_accepted + r.qty_accepted,
        qty_rejected = qty_rejected + r.qty_damaged + r.qty_wrong_part
    where id = r.po_line_id;

    if r.qty_accepted > 0 then
      perform private.post_move(v_po.workshop_id, r.part_id, 'grn', r.qty_accepted, null, v_rcv, p_request_id,
        p_grn_line_id => v_grn_line);
      if not (r.part_id = any (v_parts)) then
        v_parts := v_parts || r.part_id;
      end if;
    end if;
  end loop;

  perform private.refresh_po_status(p_po_id);

  foreach v_part in array v_parts loop
    v_alloc := v_alloc || private.allocate_free_stock(v_po.workshop_id, v_part);
  end loop;

  -- Which bikes just got which parts, in allocation (FIFO) order. waiting_since is the part-wait
  -- start (SPEC §10): greatest(arrived_at, confirmed_at), null while the bike is in transit.
  select coalesce(jsonb_agg(jsonb_build_object(
      'reg_no', b.reg_no, 'card_code', c.code, 'line_id', l.id, 'part_id', p.id, 'part', p.sku,
      'part_name', p.name, 'qty', (a.item ->> 'qty')::int,
      'waiting_since', case when b.arrived_at is not null then greatest(b.arrived_at, c.confirmed_at) end)
    order by a.ord), '[]'::jsonb)
  into v_allocations
  from jsonb_array_elements(v_alloc) with ordinality as a (item, ord)
  join public.job_card_lines l on l.id = (a.item ->> 'line_id')::uuid
  join public.job_cards c on c.id = l.job_card_id
  join public.bikes b on b.id = c.bike_id
  join public.parts p on p.id = l.part_id;

  v_result := jsonb_build_object('grn', private.grn_payload(v_grn), 'allocations', v_allocations);
  perform private.log_activity(v_po.workshop_id, 'grn', v_grn, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_po.workshop_id, v_parts);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- short_close_po (manager, SPEC §7.5): sent or partially received POs; on the chosen lines (null
-- = all) with open_qty > 0, qty_cancelled = qty_ordered - qty_accepted.

create function public.short_close_po(p_request_id uuid, p_po_id uuid, p_line_ids uuid[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'short_close_po';
  v_done jsonb;
  v_reason text;
  v_po public.purchase_orders;
  v_status public.po_status;
  v_closed jsonb;
  v_parts uuid[];
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object(
    'po_id', p_po_id, 'line_ids', p_line_ids, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  v_reason := private.require_reason(p_reason);
  if p_line_ids is not null and cardinality(p_line_ids) = 0 then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_line_ids'));
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
  if p_line_ids is not null and exists (
    select 1 from unnest(p_line_ids) as t (id)
    where not exists (select 1 from public.po_lines pl where pl.id = t.id and pl.po_id = p_po_id)
  ) then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_line_ids', 'reason', 'po_line_not_on_po'));
  end if;

  with closed as (
    update public.po_lines pl
    set qty_cancelled = pl.qty_ordered - pl.qty_accepted
    where pl.po_id = p_po_id
      and (p_line_ids is null or pl.id = any (p_line_ids))
      and pl.open_qty > 0
    returning pl.id, pl.part_id, pl.qty_cancelled
  )
  select jsonb_agg(jsonb_build_object('line_id', closed.id, 'part_id', closed.part_id, 'qty_cancelled', closed.qty_cancelled)),
    array_agg(closed.part_id)
  into v_closed, v_parts
  from closed;
  if v_closed is null then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'nothing_open'));
  end if;

  v_status := private.refresh_po_status(p_po_id);
  if v_status = 'cancelled' then
    update public.purchase_orders set cancel_reason = v_reason where id = p_po_id;
  end if;

  v_result := private.po_payload(p_po_id) || jsonb_build_object('closed_lines', v_closed, 'reason', v_reason);
  perform private.log_activity(v_po.workshop_id, 'purchase_order', p_po_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_po.workshop_id, v_parts);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- cancel_po (manager, SPEC §7.5): a draft is deleted with its lines; a sent PO with nothing
-- accepted gets every line cancelled (status cancelled); anything accepted -> ALREADY_RECEIVED.

create function public.cancel_po(p_request_id uuid, p_po_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '3s'
as $$
declare
  c_fn constant text := 'cancel_po';
  v_done jsonb;
  v_reason text;
  v_po public.purchase_orders;
  v_parts uuid[];
  v_accepted int;
  v_result jsonb;
begin
  v_done := private.begin_request(c_fn, p_request_id, jsonb_build_object('po_id', p_po_id, 'reason', p_reason));
  if v_done is not null then
    return v_done;
  end if;

  v_reason := private.require_reason(p_reason);

  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then
    perform private.err('NOT_FOUND', jsonb_build_object('po_id', p_po_id));
  end if;

  perform private.authorize('manager', v_po.workshop_id);
  perform private.lock_workshop(v_po.workshop_id);

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  select coalesce(array_agg(pl.part_id), '{}'), coalesce(sum(pl.qty_accepted), 0)
  into v_parts, v_accepted
  from public.po_lines pl
  where pl.po_id = p_po_id;

  if v_po.status = 'draft' then
    delete from public.po_lines where po_id = p_po_id;
    delete from public.purchase_orders where id = p_po_id;
    v_result := jsonb_build_object('po_id', p_po_id, 'code', v_po.code, 'status', 'deleted', 'reason', v_reason);
  else
    if v_po.status = 'cancelled' then
      perform private.err('VALIDATION', jsonb_build_object('reason', 'already_cancelled'));
    end if;
    if v_accepted > 0 then
      perform private.err('ALREADY_RECEIVED', jsonb_build_object('status', v_po.status, 'qty_accepted', v_accepted));
    end if;
    update public.po_lines set qty_cancelled = qty_ordered - qty_accepted where po_id = p_po_id;
    update public.purchase_orders set cancel_reason = v_reason where id = p_po_id;
    perform private.refresh_po_status(p_po_id);
    v_result := private.po_payload(p_po_id) || jsonb_build_object('reason', v_reason);
  end if;

  perform private.log_activity(v_po.workshop_id, 'purchase_order', p_po_id, c_fn, v_result, p_request_id);
  perform private.assert_invariants(v_po.workshop_id, v_parts);
  return private.finish_request(c_fn, p_request_id, v_result);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- ETA for waiting bikes (SPEC §7.6). Uncovered lines ranked by the FIFO key with a running total
-- of uncovered qty; open PO lines ranked sent/partially received first (by expected_on, then PO
-- code), then drafts (by code), with a running total of open_qty. A line takes the first PO whose
-- running total covers its own: a sent PO gives an ETA; a draft gives "In draft"; none gives
-- "Not ordered". Aggregated per (workshop, part) by window functions, never joined before.

create view public.v_line_eta
with (security_invoker = true)
as
with need as (
  select
    l.workshop_id,
    l.part_id,
    l.id as line_id,
    c.id as job_card_id,
    c.code as card_code,
    c.bike_id,
    b.reg_no,
    c.needed_by,
    l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) as uncovered,
    sum(l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned)) over (
      partition by l.workshop_id, l.part_id
      order by c.needed_by asc nulls last, c.confirmed_at asc, l.id asc
    ) as cum_need
  from public.job_card_lines l
  join public.job_cards c on c.id = l.job_card_id
  join public.bikes b on b.id = c.bike_id
  where c.status = 'confirmed'
    and l.cancelled_at is null
    and l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) > 0
),
supply as (
  select
    pl.workshop_id,
    pl.part_id,
    po.id as po_id,
    po.code as po_code,
    po.status as po_status,
    po.expected_on,
    sum(pl.open_qty) over (
      partition by pl.workshop_id, pl.part_id
      order by (po.status = 'draft') asc, po.expected_on asc nulls last, po.code asc
    ) as cum_supply
  from public.po_lines pl
  join public.purchase_orders po on po.id = pl.po_id
  where po.status in ('draft', 'sent', 'partially_received')
    and pl.open_qty > 0
)
select
  n.workshop_id,
  n.part_id,
  n.line_id,
  n.job_card_id,
  n.card_code,
  n.bike_id,
  n.reg_no,
  n.needed_by,
  n.uncovered::int as uncovered,
  case
    when s.po_id is null then 'not_ordered'
    when s.po_status = 'draft' then 'in_draft'
    else 'on_po'
  end as eta_status,
  s.po_id,
  s.po_code,
  case when s.po_status <> 'draft' then s.expected_on end as expected_on,
  coalesce(s.po_status <> 'draft' and s.expected_on < private.ist_today(), false) as is_overdue
from need n
left join lateral (
  select sp.*
  from supply sp
  where sp.workshop_id = n.workshop_id and sp.part_id = n.part_id and sp.cum_supply >= n.cum_need
  order by sp.cum_supply
  limit 1
) s on true;

grant select on public.v_line_eta to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Excess on order (SPEC §7.7): excess = max(0, least(on_order, projected - target)), target =
-- max(max_qty, ROP + 1) for auto parts (the level §7.1 orders up to) and 0 for on-demand parts.
-- Same formula function as generation; keys limited to the caller's workshops.

create view public.v_excess_on_order
with (security_invoker = true)
as
select
  w.id as workshop_id,
  q.part_id,
  p.sku,
  p.name,
  q.usable_on_hand,
  q.on_order,
  q.outstanding_demand,
  q.projected,
  q.is_auto,
  q.rop,
  t.target,
  greatest(0, least(q.on_order, q.projected - t.target)) as excess
from public.workshops w
cross join lateral private.po_requirements(w.id, private.ist_today()) q
join public.parts p on p.id = q.part_id
left join public.reorder_settings rs on rs.workshop_id = w.id and rs.part_id = q.part_id
cross join lateral (
  select case when q.is_auto then greatest(rs.max_qty, q.rop + 1) else 0 end as target
) t
where ((select private.is_admin()) or w.id = (select private.my_workshop_id()))
  and greatest(0, least(q.on_order, q.projected - t.target)) > 0;

grant select on public.v_excess_on_order to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function private.po_requirements(uuid, date) from public, anon;
revoke execute on function private.refresh_po_status(uuid) from public, anon;
revoke execute on function private.indian_fy(date) from public, anon;
revoke execute on function private.grn_qty(jsonb, text, int) from public, anon;
revoke execute on function private.grn_payload(uuid) from public, anon;
revoke execute on function public.receive_grn(uuid, uuid, text, date, boolean, jsonb) from public, anon;
revoke execute on function public.short_close_po(uuid, uuid, uuid[], text) from public, anon;
revoke execute on function public.cancel_po(uuid, uuid, text) from public, anon;

grant execute on function private.po_requirements(uuid, date) to authenticated;
grant execute on function public.receive_grn(uuid, uuid, text, date, boolean, jsonb) to authenticated;
grant execute on function public.short_close_po(uuid, uuid, uuid[], text) to authenticated;
grant execute on function public.cancel_po(uuid, uuid, text) to authenticated;
