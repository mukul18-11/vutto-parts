-- Read SQL for the purchasing, receiving, putaway and stock control screens (CLAUDE.md rule 12):
-- the PO list with totals, GRNs per PO, receiving-bin stock waiting for putaway, the cycle count
-- list and quarantine stock. All security_invoker views, so RLS limits every row to the caller's
-- workshops. Each source is aggregated in its own CTE before joining (SPEC §4).

-- ---------------------------------------------------------------------------------------------
-- PO list: one row per PO with supplier, line totals (incl. GST, paise) and GRN count.
-- total_paise sums only priced lines; missing_price_count says how many lines still lack a price.

create view public.v_po_list
with (security_invoker = true)
as
with lines as (
  select
    pl.po_id,
    count(*)::int as line_count,
    sum(pl.qty_ordered)::int as qty_ordered,
    sum(pl.qty_accepted)::int as qty_accepted,
    sum(pl.qty_rejected)::int as qty_rejected,
    sum(pl.qty_cancelled)::int as qty_cancelled,
    sum(pl.open_qty)::int as open_qty,
    coalesce(sum(pl.qty_ordered::bigint * pl.unit_price_paise), 0)::bigint as total_paise,
    (count(*) filter (where pl.unit_price_paise is null))::int as missing_price_count
  from public.po_lines pl
  group by pl.po_id
),
g as (
  select gr.po_id, count(*)::int as grn_count, max(gr.received_at) as last_received_at
  from public.grns gr
  group by gr.po_id
)
select
  po.id,
  po.workshop_id,
  po.code,
  po.status,
  po.supplier_id,
  s.name as supplier_name,
  s.phone as supplier_phone,
  s.lead_time_days,
  po.sent_at,
  po.expected_on,
  po.cancel_reason,
  po.is_simulated,
  po.created_at,
  (po.status in ('sent', 'partially_received') and po.expected_on < private.ist_today()) as is_overdue,
  coalesce(lines.line_count, 0) as line_count,
  coalesce(lines.qty_ordered, 0) as qty_ordered,
  coalesce(lines.qty_accepted, 0) as qty_accepted,
  coalesce(lines.qty_rejected, 0) as qty_rejected,
  coalesce(lines.qty_cancelled, 0) as qty_cancelled,
  coalesce(lines.open_qty, 0) as open_qty,
  coalesce(lines.total_paise, 0) as total_paise,
  coalesce(lines.missing_price_count, 0) as missing_price_count,
  coalesce(g.grn_count, 0) as grn_count,
  g.last_received_at
from public.purchase_orders po
join public.suppliers s on s.id = po.supplier_id
left join lines on lines.po_id = po.id
left join g on g.po_id = po.id;

-- ---------------------------------------------------------------------------------------------
-- GRN list: one row per GRN with who received it and its quantities and accepted value.

create view public.v_grn_list
with (security_invoker = true)
as
with lines as (
  select
    gl.grn_id,
    sum(gl.qty_received)::int as qty_received,
    sum(gl.qty_accepted)::int as qty_accepted,
    sum(gl.qty_damaged + gl.qty_wrong_part)::int as qty_rejected,
    sum(gl.qty_accepted::bigint * gl.unit_price_paise)::bigint as accepted_value_paise
  from public.grn_lines gl
  group by gl.grn_id
)
select
  gr.id,
  gr.workshop_id,
  gr.po_id,
  gr.code,
  gr.supplier_invoice_no,
  gr.invoice_date,
  gr.received_by,
  pr.full_name as received_by_name,
  gr.received_at,
  gr.is_simulated,
  coalesce(lines.qty_received, 0) as qty_received,
  coalesce(lines.qty_accepted, 0) as qty_accepted,
  coalesce(lines.qty_rejected, 0) as qty_rejected,
  coalesce(lines.accepted_value_paise, 0) as accepted_value_paise
from public.grns gr
left join lines on lines.grn_id = gr.id
left join public.profiles pr on pr.user_id = gr.received_by;

-- ---------------------------------------------------------------------------------------------
-- Receiving-bin stock waiting for putaway, per (receiving bin, part) with on_hand > 0.
-- oldest_in_at: walking the inbound moves into the bin newest first, the time of the move that
-- brings the running total to on_hand (FIFO: the oldest unit still in the bin arrived then).
-- reserved / reserved_for: the part's reservations in the workshop (reservations are per
-- workshop and part, not per bin), in FIFO order. suggested_bin: the active normal bin that
-- already holds the most of the part (ties: lowest code).

create view public.v_receiving_stock
with (security_invoker = true)
as
with res as (
  select
    l.workshop_id,
    l.part_id,
    sum(l.qty_reserved)::int as reserved,
    jsonb_agg(
      jsonb_build_object(
        'card_id', c.id,
        'card_code', c.code,
        'reg_no', b.reg_no,
        'qty', l.qty_reserved,
        'arrived', b.arrived_at is not null
      )
      order by c.needed_by asc nulls last, c.confirmed_at asc, l.id asc
    ) as reserved_for
  from public.job_card_lines l
  join public.job_cards c on c.id = l.job_card_id
  join public.bikes b on b.id = c.bike_id
  where l.qty_reserved > 0
  group by l.workshop_id, l.part_id
),
sug as (
  select distinct on (sb.workshop_id, sb.part_id)
    sb.workshop_id,
    sb.part_id,
    bn.id as bin_id,
    bn.code as bin_code
  from public.stock_balances sb
  join public.bins bn on bn.id = sb.bin_id
  where bn.kind = 'normal' and bn.is_active and sb.on_hand > 0
  order by sb.workshop_id, sb.part_id, sb.on_hand desc, bn.code asc
)
select
  sb.workshop_id,
  sb.bin_id,
  bn.code as bin_code,
  sb.part_id,
  p.sku,
  p.name,
  p.name_hi,
  p.uom,
  sb.on_hand,
  fifo.created_at as oldest_in_at,
  coalesce(res.reserved, 0) as reserved,
  coalesce(res.reserved_for, '[]'::jsonb) as reserved_for,
  sug.bin_id as suggested_bin_id,
  sug.bin_code as suggested_bin_code
from public.stock_balances sb
join public.bins bn on bn.id = sb.bin_id and bn.kind = 'receiving'
join public.parts p on p.id = sb.part_id
left join res on res.workshop_id = sb.workshop_id and res.part_id = sb.part_id
left join sug on sug.workshop_id = sb.workshop_id and sug.part_id = sb.part_id
left join lateral (
  select r.created_at
  from (
    select m.id, m.created_at, sum(m.qty) over (order by m.id desc) as run
    from public.stock_moves m
    where m.to_bin_id = sb.bin_id and m.part_id = sb.part_id
  ) r
  where r.run >= sb.on_hand
  order by r.id desc
  limit 1
) fifo on true
where sb.on_hand > 0;

-- ---------------------------------------------------------------------------------------------
-- Cycle count list: active bins with their count request and what they hold.

create view public.v_count_bins
with (security_invoker = true)
as
with bal as (
  select
    sb.bin_id,
    (count(*) filter (where sb.on_hand > 0))::int as part_count,
    sum(sb.on_hand)::int as total_on_hand
  from public.stock_balances sb
  group by sb.bin_id
)
select
  bn.id,
  bn.workshop_id,
  bn.code,
  bn.kind,
  bn.count_requested_at,
  coalesce(bal.part_count, 0) as part_count,
  coalesce(bal.total_on_hand, 0) as total_on_hand
from public.bins bn
left join bal on bal.bin_id = bn.id
where bn.is_active;

-- ---------------------------------------------------------------------------------------------
-- Quarantine stock: per (quarantine bin, part) with on_hand > 0, with the latest move into the
-- bin for that part (why it is there and who put it there).

create view public.v_quarantine_stock
with (security_invoker = true)
as
select
  sb.workshop_id,
  sb.bin_id,
  bn.code as bin_code,
  sb.part_id,
  p.sku,
  p.name,
  p.name_hi,
  p.uom,
  sb.on_hand,
  last_in.created_at as last_in_at,
  last_in.move_type as last_move_type,
  last_in.reason as last_reason,
  last_in.note as last_note,
  last_in.user_full_name as last_user_name
from public.stock_balances sb
join public.bins bn on bn.id = sb.bin_id and bn.kind = 'quarantine'
join public.parts p on p.id = sb.part_id
left join lateral (
  select m.created_at, m.move_type, m.reason, m.note, pr.full_name as user_full_name
  from public.stock_moves m
  left join public.profiles pr on pr.user_id = m.user_id
  where m.to_bin_id = sb.bin_id and m.part_id = sb.part_id
  order by m.id desc
  limit 1
) last_in on true
where sb.on_hand > 0;

-- ---------------------------------------------------------------------------------------------
-- Grants (SPEC §11.2): every new view is readable by authenticated; RLS filters the rows.

grant select on public.v_po_list to authenticated;
grant select on public.v_grn_list to authenticated;
grant select on public.v_receiving_stock to authenticated;
grant select on public.v_count_bins to authenticated;
grant select on public.v_quarantine_stock to authenticated;
