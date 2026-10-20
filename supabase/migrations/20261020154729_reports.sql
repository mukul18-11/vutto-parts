-- Reports and metrics (SPEC §10): blocked bikes board, inbound shortfalls, emergency buys list,
-- part-wait rows, dead stock, KPIs and the stock ledger. All read-only: security_invoker views and
-- SECURITY INVOKER functions, so RLS limits every row to the caller's workshops. They call only
-- the private helpers clients may execute (SPEC §11.2). Every aggregate is computed here, never in
-- TypeScript; ratios use nullif(denominator, 0); IST days come only from private.ist_date.

-- ---------------------------------------------------------------------------------------------
-- Missing parts: one row per uncovered line on a confirmed card, with its ETA (v_line_eta, SPEC
-- §7.6) and reallocation candidates: reservations of the same part held by another bike that is
-- itself blocked on a different part (at_workshop/in_repair, incomplete, with another uncovered
-- line). Candidates are listed latest-need first, the order dereserve_excess would release them.

create view public.v_missing_parts
with (security_invoker = true)
as
select
  e.workshop_id,
  e.part_id,
  e.line_id,
  e.job_card_id,
  e.card_code,
  e.bike_id,
  e.reg_no,
  e.needed_by,
  p.sku,
  p.name,
  p.uom,
  e.uncovered,
  e.eta_status,
  e.po_id,
  e.po_code,
  e.expected_on,
  e.is_overdue,
  coalesce(rc.candidates, '[]'::jsonb) as reallocation_candidates
from public.v_line_eta e
join public.parts p on p.id = e.part_id
left join lateral (
  select jsonb_agg(jsonb_build_object(
      'line_id', l2.id,
      'job_card_id', c2.id,
      'card_code', c2.code,
      'reg_no', b2.reg_no,
      'qty_reserved', l2.qty_reserved)
    order by c2.needed_by desc nulls first, c2.confirmed_at desc, l2.id desc) as candidates
  from public.job_card_lines l2
  join public.job_cards c2 on c2.id = l2.job_card_id
  join public.bikes b2 on b2.id = c2.bike_id
  where l2.workshop_id = e.workshop_id
    and l2.part_id = e.part_id
    and l2.job_card_id <> e.job_card_id
    and l2.cancelled_at is null
    and l2.qty_reserved > 0
    and c2.status = 'confirmed'
    and c2.parts_complete_at is null
    and b2.status in ('at_workshop', 'in_repair')
    and exists (
      select 1
      from public.job_card_lines l3
      where l3.job_card_id = c2.id
        and l3.part_id <> e.part_id
        and l3.cancelled_at is null
        and l3.qty_required - (l3.qty_reserved + l3.qty_issued - l3.qty_returned) > 0
    )
) rc on true;

grant select on public.v_missing_parts to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Blocked bikes board (SPEC §10): confirmed cards, bike at_workshop or in_repair, not complete.
-- missing_parts is '[]' when the only cause is needs_review_reason. Sort by waiting_since.
-- Missing parts are aggregated per card once, then joined (v_line_eta's windows are computed once).

create view public.v_blocked_bikes
with (security_invoker = true)
as
select
  c.workshop_id,
  b.id as bike_id,
  b.reg_no,
  vm.make,
  vm.model,
  mv.name as variant_name,
  b.mfg_year,
  b.status as bike_status,
  c.id as job_card_id,
  c.code as card_code,
  c.needed_by,
  c.confirmed_at,
  b.arrived_at,
  greatest(b.arrived_at, c.confirmed_at) as waiting_since,
  c.needs_review_reason,
  coalesce(m.missing_parts, '[]'::jsonb) as missing_parts,
  coalesce(m.missing_count, 0)::int as missing_count
from public.job_cards c
join public.bikes b on b.id = c.bike_id
join public.vehicle_models vm on vm.id = b.model_id
left join public.model_variants mv on mv.id = b.variant_id
left join (
  select mp.job_card_id,
    jsonb_agg(jsonb_build_object(
        'line_id', mp.line_id,
        'part_id', mp.part_id,
        'sku', mp.sku,
        'name', mp.name,
        'uom', mp.uom,
        'uncovered', mp.uncovered,
        'eta_status', mp.eta_status,
        'po_id', mp.po_id,
        'po_code', mp.po_code,
        'expected_on', mp.expected_on,
        'is_overdue', mp.is_overdue,
        'reallocation_candidates', mp.reallocation_candidates)
      order by mp.sku) as missing_parts,
    count(*) as missing_count
  from public.v_missing_parts mp
  group by mp.job_card_id
) m on m.job_card_id = c.id
where c.status = 'confirmed'
  and c.parts_complete_at is null
  and b.status in ('at_workshop', 'in_repair');

grant select on public.v_blocked_bikes to authenticated;

-- Inbound shortfalls (SPEC §10): purchased (in transit) bikes whose confirmed card has uncovered
-- lines. Same shape as the board, with purchased_at instead of waiting_since.

create view public.v_inbound_shortfalls
with (security_invoker = true)
as
select
  c.workshop_id,
  b.id as bike_id,
  b.reg_no,
  vm.make,
  vm.model,
  mv.name as variant_name,
  b.mfg_year,
  b.status as bike_status,
  c.id as job_card_id,
  c.code as card_code,
  c.needed_by,
  c.confirmed_at,
  b.purchased_at,
  c.needs_review_reason,
  m.missing_parts,
  m.missing_count::int as missing_count
from public.job_cards c
join public.bikes b on b.id = c.bike_id
join public.vehicle_models vm on vm.id = b.model_id
left join public.model_variants mv on mv.id = b.variant_id
join (
  select mp.job_card_id,
    jsonb_agg(jsonb_build_object(
        'line_id', mp.line_id,
        'part_id', mp.part_id,
        'sku', mp.sku,
        'name', mp.name,
        'uom', mp.uom,
        'uncovered', mp.uncovered,
        'eta_status', mp.eta_status,
        'po_id', mp.po_id,
        'po_code', mp.po_code,
        'expected_on', mp.expected_on,
        'is_overdue', mp.is_overdue,
        'reallocation_candidates', mp.reallocation_candidates)
      order by mp.sku) as missing_parts,
    count(*) as missing_count
  from public.v_missing_parts mp
  group by mp.job_card_id
) m on m.job_card_id = c.id
where c.status = 'confirmed'
  and b.status = 'purchased';

grant select on public.v_inbound_shortfalls to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Emergency buys list (SPEC §8.3, §10): premium = (price - reference) / reference, null without a
-- reference; premium_paise = qty x (price - reference). bought_on is the IST day the KPI tile
-- buckets by, so the list filtered on it totals to the same SQL figure.

create view public.v_emergency_buys_list
with (security_invoker = true)
as
select
  e.id,
  e.workshop_id,
  e.job_card_line_id,
  c.id as job_card_id,
  c.code as card_code,
  b.reg_no,
  e.part_id,
  p.sku,
  p.name as part_name,
  p.uom,
  e.vendor_name,
  e.qty,
  e.unit_price_paise,
  e.reference_price_paise,
  e.qty::bigint * e.unit_price_paise as total_paise,
  case when e.reference_price_paise > 0
    then e.qty::bigint * (e.unit_price_paise - e.reference_price_paise) end as premium_paise,
  (e.unit_price_paise - e.reference_price_paise)::numeric / nullif(e.reference_price_paise, 0) as premium,
  e.qty_issued,
  e.qty_to_stock,
  e.reason,
  e.note,
  e.bill_photo_path,
  e.bought_by,
  pr.full_name as bought_by_name,
  e.is_simulated,
  e.created_at,
  private.ist_date(e.created_at) as bought_on
from public.emergency_buys e
join public.parts p on p.id = e.part_id
left join public.job_card_lines l on l.id = e.job_card_line_id
left join public.job_cards c on c.id = l.job_card_id
left join public.bikes b on b.id = c.bike_id
left join public.profiles pr on pr.user_id = e.bought_by;

grant select on public.v_emergency_buys_list to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Part-wait rows (SPEC §10 north star), the list behind the KPI tile. For each arrived bike with
-- a confirmed or closed card: start = greatest(arrived_at, confirmed_at); a bike belongs to the
-- range in which its wait started (IST day). The cutoff is the end of the p_as_of IST day (now()
-- while that day is running): a bike not complete by then is still waiting, with its wait so far.
-- parts_complete_at is the final completion time, so a card made incomplete by a reallocation and
-- completed again counts from its last completion. p_workshop_id null = every visible workshop.

create function public.part_waits(
  p_workshop_id uuid,
  p_from date,
  p_to date,
  p_as_of date default private.ist_today()
)
returns table (
  workshop_id uuid,
  bike_id uuid,
  reg_no text,
  job_card_id uuid,
  card_code text,
  card_status public.job_card_status,
  started_at timestamptz,
  ended_at timestamptz,
  still_waiting boolean,
  wait_hours numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with cutoff as (
    -- Date to instant (not day bucketing): midnight IST after p_as_of.
    select least(now(), (p_as_of + 1)::timestamp at time zone 'Asia/Kolkata') as ts
  ),
  base as (
    select c.workshop_id, b.id as bike_id, b.reg_no, c.id as job_card_id, c.code as card_code,
      c.status as card_status,
      greatest(b.arrived_at, c.confirmed_at) as started_at,
      coalesce(c.parts_complete_at, c.closed_at) as done_at
    from public.job_cards c
    join public.bikes b on b.id = c.bike_id
    where c.status in ('confirmed', 'closed')
      and b.arrived_at is not null
      and (p_workshop_id is null or c.workshop_id = p_workshop_id)
  ),
  w as (
    select base.*,
      (base.done_at is null or base.done_at > cutoff.ts) as still_waiting,
      case when base.done_at is null or base.done_at > cutoff.ts then cutoff.ts else base.done_at end as ended_at
    from base
    cross join cutoff
    where private.ist_date(base.started_at) between p_from and p_to
      and base.started_at <= cutoff.ts
  )
  select w.workshop_id, w.bike_id, w.reg_no, w.job_card_id, w.card_code, w.card_status, w.started_at,
    w.ended_at, w.still_waiting,
    greatest(0, extract(epoch from (w.ended_at - w.started_at)) / 3600)
  from w
  order by w.started_at, w.bike_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Dead stock (SPEC §10): (w, p) with available > 0 and no issue, grn or emergency_in move in the
-- p_days IST days ending p_as_of (p_as_of - p_days + 1 .. p_as_of). Putaway, move, adjust and
-- return moves never reset the age. dead_qty = available, so reserved units and quarantine are
-- never dead. Price: last GRN price, else the effective supplier's price, else standard price.

create function public.dead_stock(
  p_workshop_id uuid,
  p_as_of date default private.ist_today(),
  p_days int default 90
)
returns table (
  workshop_id uuid,
  part_id uuid,
  sku text,
  name text,
  uom public.uom,
  available int,
  dead_qty int,
  unit_price_paise bigint,
  price_source text,
  value_paise bigint,
  last_activity_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with act as (
    select m.workshop_id, m.part_id,
      max(m.created_at) as last_at,
      bool_or(private.ist_date(m.created_at) > p_as_of - p_days) as recent
    from public.stock_moves m
    where m.move_type in ('issue', 'grn', 'emergency_in')
      and private.ist_date(m.created_at) <= p_as_of
      and (p_workshop_id is null or m.workshop_id = p_workshop_id)
    group by m.workshop_id, m.part_id
  )
  select sp.workshop_id, sp.part_id, p.sku, p.name, p.uom, sp.available, sp.available,
    pr.price, pr.source, sp.available * pr.price, act.last_at
  from public.v_stock_position sp
  join public.parts p on p.id = sp.part_id
  left join act on act.workshop_id = sp.workshop_id and act.part_id = sp.part_id
  left join public.reorder_settings rs on rs.workshop_id = sp.workshop_id and rs.part_id = sp.part_id
  left join public.supplier_parts spp
    on spp.supplier_id = coalesce(rs.preferred_supplier_id, p.preferred_supplier_id) and spp.part_id = p.id
  left join public.v_part_last_price lp on lp.part_id = p.id
  cross join lateral (
    select coalesce(lp.unit_price_paise, spp.price_paise, p.standard_price_paise) as price,
      case
        when lp.unit_price_paise is not null then 'last_grn'
        when spp.price_paise is not null then 'supplier'
        else 'standard'
      end as source
  ) pr
  where sp.available > 0
    and (p_workshop_id is null or sp.workshop_id = p_workshop_id)
    and not coalesce(act.recent, false)
  order by sp.available * pr.price desc, p.sku
$$;

-- ---------------------------------------------------------------------------------------------
-- KPIs (SPEC §10) for IST days p_from..p_to, one row. p_workshop_id null = every visible workshop
-- (admin: all, pooled over the underlying rows; never an average of workshop figures).
--   Part wait: n, completed, still waiting (count, average hours so far), % zero wait, median and
--     p90 hours over all n; the last three null when n < 5.
--   Emergency share = spend / (spend + GRN accepted value); damaged units are not accepted.
--   Premium = sum(qty x (price - ref)) / sum(qty x ref) over buys with a reference; buys without
--     one are counted separately.
--   Dead stock value as of p_as_of. Wrong-fit rate = wrong_fitment return qty / issue qty.
--   Overdue POs: sent or partially received with expected_on before p_as_of.

create function public.kpis(
  p_workshop_id uuid,
  p_from date,
  p_to date,
  p_as_of date default private.ist_today()
)
returns table (
  wait_n int,
  wait_completed_n int,
  wait_still_waiting_n int,
  wait_still_waiting_avg_hours numeric,
  wait_zero_pct numeric,
  wait_median_hours numeric,
  wait_p90_hours numeric,
  emergency_spend_paise bigint,
  grn_value_paise bigint,
  emergency_share numeric,
  emergency_premium numeric,
  emergency_without_reference_n int,
  dead_stock_value_paise bigint,
  dead_stock_sku_n int,
  wrong_fit_qty int,
  issued_qty int,
  wrong_fit_rate numeric,
  po_overdue_n int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with pw as (
    select
      count(*) as n,
      count(*) filter (where not w.still_waiting) as completed_n,
      count(*) filter (where w.still_waiting) as waiting_n,
      avg(w.wait_hours) filter (where w.still_waiting) as waiting_avg,
      count(*) filter (where w.wait_hours = 0) as zero_n,
      percentile_cont(0.5) within group (order by w.wait_hours) as median,
      percentile_cont(0.9) within group (order by w.wait_hours) as p90
    from public.part_waits(p_workshop_id, p_from, p_to, p_as_of) w
  ),
  eb as (
    select
      coalesce(sum(e.qty::bigint * e.unit_price_paise), 0) as spend,
      sum(e.qty::bigint * (e.unit_price_paise - e.reference_price_paise))
        filter (where e.reference_price_paise > 0) as premium_num,
      sum(e.qty::bigint * e.reference_price_paise) filter (where e.reference_price_paise > 0) as premium_den,
      count(*) filter (where coalesce(e.reference_price_paise, 0) <= 0) as without_ref_n
    from public.emergency_buys e
    where private.ist_date(e.created_at) between p_from and p_to
      and (p_workshop_id is null or e.workshop_id = p_workshop_id)
  ),
  gv as (
    select coalesce(sum(gl.qty_accepted::bigint * gl.unit_price_paise), 0) as value
    from public.grn_lines gl
    join public.grns g on g.id = gl.grn_id
    where private.ist_date(g.received_at) between p_from and p_to
      and (p_workshop_id is null or gl.workshop_id = p_workshop_id)
  ),
  ds as (
    select coalesce(sum(d.value_paise), 0) as value, count(*) as n
    from public.dead_stock(p_workshop_id, p_as_of) d
  ),
  mv as (
    select
      coalesce(sum(m.qty) filter (where m.move_type = 'return_to_stock' and m.reason = 'wrong_fitment'), 0) as wrong_fit,
      coalesce(sum(m.qty) filter (where m.move_type = 'issue'), 0) as issued
    from public.stock_moves m
    where m.move_type in ('issue', 'return_to_stock')
      and private.ist_date(m.created_at) between p_from and p_to
      and (p_workshop_id is null or m.workshop_id = p_workshop_id)
  ),
  po as (
    select count(*) as n
    from public.purchase_orders o
    where o.status in ('sent', 'partially_received')
      and o.expected_on < p_as_of
      and (p_workshop_id is null or o.workshop_id = p_workshop_id)
  )
  select
    pw.n::int,
    pw.completed_n::int,
    pw.waiting_n::int,
    round(pw.waiting_avg, 2),
    case when pw.n >= 5 then pw.zero_n::numeric / nullif(pw.n, 0) end,
    case when pw.n >= 5 then round(pw.median::numeric, 2) end,
    case when pw.n >= 5 then round(pw.p90::numeric, 2) end,
    eb.spend::bigint,
    gv.value::bigint,
    eb.spend::numeric / nullif(eb.spend + gv.value, 0),
    eb.premium_num::numeric / nullif(eb.premium_den, 0),
    eb.without_ref_n::int,
    ds.value::bigint,
    ds.n::int,
    mv.wrong_fit::int,
    mv.issued::int,
    mv.wrong_fit::numeric / nullif(mv.issued, 0),
    po.n::int
  from pw, eb, gv, ds, mv, po
$$;

-- ---------------------------------------------------------------------------------------------
-- Stock ledger: moves newest first, keyset-paginated (pass the last id seen as p_before_id).
-- p_part_id / p_bin_id null = all; with a bin, bin_delta is the signed change to that bin.
-- Names come from profiles (RLS shows same-workshop and admin names); references from the line's
-- card and bike, the GRN line's GRN and PO, or the emergency buy.

create function public.stock_ledger(
  p_workshop_id uuid,
  p_part_id uuid,
  p_limit int default 50,
  p_bin_id uuid default null,
  p_before_id bigint default null
)
returns table (
  id bigint,
  created_at timestamptz,
  move_type public.move_type,
  qty int,
  bin_delta int,
  workshop_id uuid,
  part_id uuid,
  sku text,
  part_name text,
  from_bin_id uuid,
  from_bin_code text,
  to_bin_id uuid,
  to_bin_code text,
  reason text,
  note text,
  user_id uuid,
  user_full_name text,
  job_card_line_id uuid,
  job_card_code text,
  reg_no text,
  grn_code text,
  po_code text,
  emergency_buy_id uuid,
  emergency_vendor text,
  is_simulated boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.created_at, m.move_type, m.qty,
    case
      when p_bin_id is null then null
      when m.to_bin_id = p_bin_id then m.qty
      else -m.qty
    end,
    m.workshop_id, m.part_id, p.sku, p.name,
    m.from_bin_id, fb.code, m.to_bin_id, tb.code,
    m.reason, m.note, m.user_id, pr.full_name,
    m.job_card_line_id, c.code, b.reg_no,
    g.code, o.code,
    m.emergency_buy_id, e.vendor_name,
    m.is_simulated
  from public.stock_moves m
  join public.parts p on p.id = m.part_id
  left join public.bins fb on fb.id = m.from_bin_id
  left join public.bins tb on tb.id = m.to_bin_id
  left join public.profiles pr on pr.user_id = m.user_id
  left join public.job_card_lines l on l.id = m.job_card_line_id
  left join public.job_cards c on c.id = l.job_card_id
  left join public.bikes b on b.id = c.bike_id
  left join public.grn_lines gl on gl.id = m.grn_line_id
  left join public.grns g on g.id = gl.grn_id
  left join public.purchase_orders o on o.id = g.po_id
  left join public.emergency_buys e on e.id = m.emergency_buy_id
  where (p_workshop_id is null or m.workshop_id = p_workshop_id)
    and (p_part_id is null or m.part_id = p_part_id)
    and (p_bin_id is null or m.from_bin_id = p_bin_id or m.to_bin_id = p_bin_id)
    and (p_before_id is null or m.id < p_before_id)
  order by m.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function public.part_waits(uuid, date, date, date) from public, anon;
revoke execute on function public.dead_stock(uuid, date, int) from public, anon;
revoke execute on function public.kpis(uuid, date, date, date) from public, anon;
revoke execute on function public.stock_ledger(uuid, uuid, int, uuid, bigint) from public, anon;

grant execute on function public.part_waits(uuid, date, date, date) to authenticated;
grant execute on function public.dead_stock(uuid, date, int) to authenticated;
grant execute on function public.kpis(uuid, date, date, date) to authenticated;
grant execute on function public.stock_ledger(uuid, uuid, int, uuid, bigint) to authenticated;
