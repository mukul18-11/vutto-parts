-- Store counter reads (SPEC §8, §9.2, §14): the issue/return card finder, the lines a store keeper
-- may cover with an emergency buy, the store home tile counts, and the emergency buy context of a
-- line (remaining need, reference price, where its stock is). All read-only: security_invoker
-- views and SECURITY INVOKER functions, so RLS limits every row to the caller's workshop. Line
-- aggregates are computed per card before joining (never join two line sources first).

-- ---------------------------------------------------------------------------------------------
-- Confirmed cards of bikes at the workshop or in a bay, with their line counts. The issue queue
-- reads reserved_qty > 0; the return finder reads returnable_lines > 0 (returns need a confirmed
-- card, SPEC §8.2). code_norm: the card code reduced to A–Z0–9 for suffix search.

create view public.v_store_cards
with (security_invoker = true)
as
with agg as (
  select
    l.job_card_id,
    count(*) filter (where l.qty_reserved > 0)::int as reserved_lines,
    coalesce(sum(l.qty_reserved), 0)::int as reserved_qty,
    count(*) filter (where l.qty_issued - l.qty_returned > 0)::int as returnable_lines,
    count(*) filter (
      where l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) > 0
    )::int as uncovered_lines
  from public.job_card_lines l
  where l.cancelled_at is null
  group by l.job_card_id
)
select
  c.id as card_id,
  c.workshop_id,
  c.code,
  regexp_replace(upper(c.code), '[^A-Z0-9]', '', 'g') as code_norm,
  c.needed_by,
  c.confirmed_at,
  b.id as bike_id,
  b.reg_no,
  b.reg_no_norm,
  b.status as bike_status,
  vm.make,
  vm.model,
  mv.name as variant_name,
  b.mfg_year,
  coalesce(agg.reserved_lines, 0) as reserved_lines,
  coalesce(agg.reserved_qty, 0) as reserved_qty,
  coalesce(agg.returnable_lines, 0) as returnable_lines,
  coalesce(agg.uncovered_lines, 0) as uncovered_lines
from public.job_cards c
join public.bikes b on b.id = c.bike_id
join public.vehicle_models vm on vm.id = b.model_id
left join public.model_variants mv on mv.id = b.variant_id
left join agg on agg.job_card_id = c.id
where c.status = 'confirmed'
  and b.status in ('at_workshop', 'in_repair');

grant select on public.v_store_cards to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Uncovered lines on bikes at the workshop or in a bay (the store keeper's emergency buy list),
-- with each line's ETA from v_missing_parts (SPEC §7.6) so a PO due soon can be waited for.

create view public.v_store_waiting_lines
with (security_invoker = true)
as
select
  mp.workshop_id,
  mp.line_id,
  mp.job_card_id,
  mp.card_code,
  mp.bike_id,
  mp.reg_no,
  b.status as bike_status,
  vm.make,
  vm.model,
  mv.name as variant_name,
  b.mfg_year,
  mp.needed_by,
  mp.part_id,
  mp.sku,
  mp.name,
  p.name_hi,
  mp.uom,
  mp.uncovered,
  mp.eta_status,
  mp.po_id,
  mp.po_code,
  mp.expected_on,
  mp.is_overdue
from public.v_missing_parts mp
join public.bikes b on b.id = mp.bike_id
join public.vehicle_models vm on vm.id = b.model_id
left join public.model_variants mv on mv.id = b.variant_id
join public.parts p on p.id = mp.part_id
where b.status in ('at_workshop', 'in_repair');

grant select on public.v_store_waiting_lines to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Store home tile counts for one workshop (SPEC §14 store home). to_receive matches the
-- receiving list (sent or partially received POs); to_put_away counts (receiving bin, part) rows
-- with stock; ready_to_issue counts cards holding reservations; emergency_waiting counts bikes
-- at the workshop with an uncovered line.

create function public.store_home_counts(p_workshop_id uuid)
returns table (to_receive int, to_put_away int, ready_to_issue int, emergency_waiting int)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*)::int from public.purchase_orders po
     where po.workshop_id = p_workshop_id and po.status in ('sent', 'partially_received')),
    (select count(*)::int from public.v_receiving_stock rs
     where rs.workshop_id = p_workshop_id),
    (select count(*)::int from public.v_store_cards sc
     where sc.workshop_id = p_workshop_id and sc.reserved_qty > 0),
    (select count(distinct wl.bike_id)::int from public.v_store_waiting_lines wl
     where wl.workshop_id = p_workshop_id)
$$;

-- ---------------------------------------------------------------------------------------------
-- Emergency buy context of one line (SPEC §8.3), shown before the buy:
--   remaining_need = qty_required − net_issued (what the buy can issue at most);
--   reference_price_paise = the snapshot record_emergency_buy will take (private.reference_price:
--     effective supplier's supplier_parts price ?? last GRN price ?? standard price), rebuilt
--     from tables clients can read, so the UI can show the premium live;
--   reserved_bins = bins holding the part while this line holds a reservation ("issue it
--     instead"), receiving first; held_by = other lines holding the part ("ask the manager to
--     reallocate"). No row when the line is not visible (other workshop or missing).

create function public.emergency_context(p_line_id uuid)
returns table (
  line_id uuid,
  workshop_id uuid,
  part_id uuid,
  remaining_need int,
  qty_reserved int,
  available int,
  reference_price_paise bigint,
  reserved_bins jsonb,
  held_by jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.id,
    l.workshop_id,
    l.part_id,
    greatest(0, l.qty_required - (l.qty_issued - l.qty_returned)),
    l.qty_reserved,
    coalesce((select sp.available from public.v_stock_position sp
              where sp.workshop_id = l.workshop_id and sp.part_id = l.part_id), 0),
    coalesce(
      (select s.price_paise from public.supplier_parts s
       where s.part_id = l.part_id
         and s.supplier_id = coalesce(
           (select rs.preferred_supplier_id from public.reorder_settings rs
            where rs.workshop_id = l.workshop_id and rs.part_id = l.part_id),
           p.preferred_supplier_id)),
      (select lp.unit_price_paise from public.v_part_last_price lp where lp.part_id = l.part_id),
      p.standard_price_paise),
    case when l.qty_reserved > 0 then coalesce((
      select jsonb_agg(jsonb_build_object('bin_id', bn.id, 'code', bn.code, 'kind', bn.kind,
                                          'on_hand', sb.on_hand)
                       order by (bn.kind = 'receiving') desc, sb.on_hand desc, bn.code)
      from public.stock_balances sb
      join public.bins bn on bn.id = sb.bin_id
      where sb.workshop_id = l.workshop_id and sb.part_id = l.part_id and sb.on_hand > 0
        and bn.kind in ('normal', 'receiving')), '[]'::jsonb)
    else '[]'::jsonb end,
    coalesce((
      select jsonb_agg(jsonb_build_object('card_code', c2.code, 'reg_no', b2.reg_no,
                                          'qty', l2.qty_reserved)
                       order by c2.code)
      from public.job_card_lines l2
      join public.job_cards c2 on c2.id = l2.job_card_id
      join public.bikes b2 on b2.id = c2.bike_id
      where l2.workshop_id = l.workshop_id and l2.part_id = l.part_id
        and l2.id <> l.id and l2.qty_reserved > 0), '[]'::jsonb)
  from public.job_card_lines l
  join public.parts p on p.id = l.part_id
  where l.id = p_line_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function public.store_home_counts(uuid) from public, anon;
revoke execute on function public.emergency_context(uuid) from public, anon;

grant execute on function public.store_home_counts(uuid) to authenticated;
grant execute on function public.emergency_context(uuid) to authenticated;
