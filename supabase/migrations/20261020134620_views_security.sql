-- Stock position (SPEC §4), last purchase price (SPEC §7.4) and the invariant checks.
--
-- The §4 measures exist twice, with the same CTEs: public.v_stock_position for clients
-- (security_invoker; its keys are limited to the caller's workshops), and
-- private.stock_position(w, parts) for server code running as the owner (check_invariants and,
-- later, the RPCs), where no auth.uid() exists to pick workshops. A test asserts they agree.
-- Each measure is aggregated in its own CTE before the join, so no source multiplies another.

create view public.v_stock_position
with (security_invoker = true)
as
with keys as (
  select w.id as workshop_id, p.id as part_id
  from public.workshops w
  cross join public.parts p
  where (select private.is_admin()) or w.id = (select private.my_workshop_id())
),
bal as (
  select b.workshop_id, b.part_id,
    sum(b.on_hand) filter (where bn.kind in ('normal', 'receiving')) as usable_on_hand,
    sum(b.on_hand) filter (where bn.kind = 'quarantine') as quarantine_on_hand
  from public.stock_balances b
  join public.bins bn on bn.id = b.bin_id
  group by b.workshop_id, b.part_id
),
res as (
  select l.workshop_id, l.part_id, sum(l.qty_reserved) as reserved
  from public.job_card_lines l
  group by l.workshop_id, l.part_id
),
dem as (
  select l.workshop_id, l.part_id,
    sum(l.qty_required - (l.qty_issued - l.qty_returned)) as outstanding_demand,
    sum(l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned)) as shortfall
  from public.job_card_lines l
  join public.job_cards c on c.id = l.job_card_id
  where c.status = 'confirmed' and l.cancelled_at is null
  group by l.workshop_id, l.part_id
),
ord as (
  select pl.workshop_id, pl.part_id, sum(pl.open_qty) as on_order
  from public.po_lines pl
  join public.purchase_orders po on po.id = pl.po_id
  where po.status in ('draft', 'sent', 'partially_received')
  group by pl.workshop_id, pl.part_id
)
select
  k.workshop_id,
  k.part_id,
  coalesce(bal.usable_on_hand, 0)::int as usable_on_hand,
  coalesce(bal.quarantine_on_hand, 0)::int as quarantine_on_hand,
  coalesce(res.reserved, 0)::int as reserved,
  (coalesce(bal.usable_on_hand, 0) - coalesce(res.reserved, 0))::int as available,
  coalesce(ord.on_order, 0)::int as on_order,
  coalesce(dem.outstanding_demand, 0)::int as outstanding_demand,
  coalesce(dem.shortfall, 0)::int as shortfall
from keys k
left join bal on bal.workshop_id = k.workshop_id and bal.part_id = k.part_id
left join res on res.workshop_id = k.workshop_id and res.part_id = k.part_id
left join dem on dem.workshop_id = k.workshop_id and dem.part_id = k.part_id
left join ord on ord.workshop_id = k.workshop_id and ord.part_id = k.part_id;

grant select on public.v_stock_position to authenticated;

-- Server-side twin of v_stock_position: same measures, keys chosen by the arguments
-- (null = all workshops / all parts). Not executable by clients.
create function private.stock_position(p_workshop_id uuid default null, p_part_ids uuid[] default null)
returns table (
  workshop_id uuid,
  part_id uuid,
  usable_on_hand int,
  quarantine_on_hand int,
  reserved int,
  available int,
  on_order int,
  outstanding_demand int,
  shortfall int
)
language sql
stable
set search_path = ''
as $$
  with keys as (
    select w.id as workshop_id, p.id as part_id
    from public.workshops w
    cross join public.parts p
    where (p_workshop_id is null or w.id = p_workshop_id)
      and (p_part_ids is null or p.id = any (p_part_ids))
  ),
  bal as (
    select b.workshop_id, b.part_id,
      sum(b.on_hand) filter (where bn.kind in ('normal', 'receiving')) as usable_on_hand,
      sum(b.on_hand) filter (where bn.kind = 'quarantine') as quarantine_on_hand
    from public.stock_balances b
    join public.bins bn on bn.id = b.bin_id
    where (p_workshop_id is null or b.workshop_id = p_workshop_id)
      and (p_part_ids is null or b.part_id = any (p_part_ids))
    group by b.workshop_id, b.part_id
  ),
  res as (
    select l.workshop_id, l.part_id, sum(l.qty_reserved) as reserved
    from public.job_card_lines l
    where (p_workshop_id is null or l.workshop_id = p_workshop_id)
      and (p_part_ids is null or l.part_id = any (p_part_ids))
    group by l.workshop_id, l.part_id
  ),
  dem as (
    select l.workshop_id, l.part_id,
      sum(l.qty_required - (l.qty_issued - l.qty_returned)) as outstanding_demand,
      sum(l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned)) as shortfall
    from public.job_card_lines l
    join public.job_cards c on c.id = l.job_card_id
    where c.status = 'confirmed' and l.cancelled_at is null
      and (p_workshop_id is null or l.workshop_id = p_workshop_id)
      and (p_part_ids is null or l.part_id = any (p_part_ids))
    group by l.workshop_id, l.part_id
  ),
  ord as (
    select pl.workshop_id, pl.part_id, sum(pl.open_qty) as on_order
    from public.po_lines pl
    join public.purchase_orders po on po.id = pl.po_id
    where po.status in ('draft', 'sent', 'partially_received')
      and (p_workshop_id is null or pl.workshop_id = p_workshop_id)
      and (p_part_ids is null or pl.part_id = any (p_part_ids))
    group by pl.workshop_id, pl.part_id
  )
  select
    k.workshop_id,
    k.part_id,
    coalesce(bal.usable_on_hand, 0)::int,
    coalesce(bal.quarantine_on_hand, 0)::int,
    coalesce(res.reserved, 0)::int,
    (coalesce(bal.usable_on_hand, 0) - coalesce(res.reserved, 0))::int,
    coalesce(ord.on_order, 0)::int,
    coalesce(dem.outstanding_demand, 0)::int,
    coalesce(dem.shortfall, 0)::int
  from keys k
  left join bal on bal.workshop_id = k.workshop_id and bal.part_id = k.part_id
  left join res on res.workshop_id = k.workshop_id and res.part_id = k.part_id
  left join dem on dem.workshop_id = k.workshop_id and dem.part_id = k.part_id
  left join ord on ord.workshop_id = k.workshop_id and ord.part_id = k.part_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Last purchase price per part (SPEC §7.4): the latest GRN line with accepted units.
-- Emergency buys never affect it.

create view public.v_part_last_price
with (security_invoker = true)
as
select distinct on (gl.part_id)
  gl.part_id,
  gl.unit_price_paise,
  g.received_at,
  gl.grn_id
from public.grn_lines gl
join public.grns g on g.id = gl.grn_id
where gl.qty_accepted > 0
order by gl.part_id, g.received_at desc, gl.created_at desc, gl.id desc;

grant select on public.v_part_last_price to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Invariants (SPEC §4 items 1-9). Each returns the violating rows; none means healthy.
-- check_invariants_for(w, parts) runs items 1-6 for those parts (the per-RPC check, SPEC §11.1
-- step 6); null arguments mean all. check_invariants() runs everything.

create function private.check_invariants_for(p_workshop_id uuid, p_part_ids uuid[])
returns table (invariant text, details jsonb)
language plpgsql
stable
set search_path = ''
as $$
begin
  -- 1. on_hand = moved in - moved out, per (bin, part).
  return query
  with moved as (
    select m.workshop_id, x.bin_id, m.part_id, sum(x.qty) as net
    from public.stock_moves m
    cross join lateral (
      values (m.to_bin_id, m.qty), (m.from_bin_id, -m.qty)
    ) as x (bin_id, qty)
    where x.bin_id is not null
      and (p_workshop_id is null or m.workshop_id = p_workshop_id)
      and (p_part_ids is null or m.part_id = any (p_part_ids))
    group by m.workshop_id, x.bin_id, m.part_id
  ),
  bal as (
    select b.workshop_id, b.bin_id, b.part_id, b.on_hand
    from public.stock_balances b
    where (p_workshop_id is null or b.workshop_id = p_workshop_id)
      and (p_part_ids is null or b.part_id = any (p_part_ids))
  )
  select '1_balance_matches_moves', jsonb_build_object(
      'workshop_id', coalesce(bal.workshop_id, moved.workshop_id),
      'bin_id', coalesce(bal.bin_id, moved.bin_id),
      'part_id', coalesce(bal.part_id, moved.part_id),
      'on_hand', bal.on_hand, 'moves_net', moved.net)
  from bal
  full join moved on moved.bin_id = bal.bin_id and moved.part_id = bal.part_id
  where coalesce(bal.on_hand, 0) <> coalesce(moved.net, 0);

  -- 2. on_hand >= 0.
  return query
  select '2_on_hand_non_negative', jsonb_build_object(
      'workshop_id', b.workshop_id, 'bin_id', b.bin_id, 'part_id', b.part_id, 'on_hand', b.on_hand)
  from public.stock_balances b
  where b.on_hand < 0
    and (p_workshop_id is null or b.workshop_id = p_workshop_id)
    and (p_part_ids is null or b.part_id = any (p_part_ids));

  -- 3. 0 <= reserved <= usable_on_hand; 4. available > 0 implies shortfall = 0.
  return query
  select '3_reserved_within_usable', to_jsonb(s)
  from private.stock_position(p_workshop_id, p_part_ids) s
  where s.reserved < 0 or s.reserved > s.usable_on_hand;

  return query
  select '4_no_free_stock_while_short', to_jsonb(s)
  from private.stock_position(p_workshop_id, p_part_ids) s
  where s.available > 0 and s.shortfall <> 0;

  -- 5. Lines on cards that are not confirmed hold no reservation.
  return query
  select '5_reservation_on_unconfirmed_card', jsonb_build_object(
      'line_id', l.id, 'job_card_id', c.id, 'status', c.status, 'qty_reserved', l.qty_reserved)
  from public.job_card_lines l
  join public.job_cards c on c.id = l.job_card_id
  where c.status <> 'confirmed' and l.qty_reserved <> 0
    and (p_workshop_id is null or l.workshop_id = p_workshop_id)
    and (p_part_ids is null or l.part_id = any (p_part_ids));

  -- 6. qty_issued / qty_returned equal the line's issue / return moves.
  return query
  with mv as (
    select m.job_card_line_id,
      sum(m.qty) filter (where m.move_type = 'issue') as issued,
      sum(m.qty) filter (where m.move_type in ('return_to_stock', 'return_to_quarantine')) as returned
    from public.stock_moves m
    where m.job_card_line_id is not null
      and (p_workshop_id is null or m.workshop_id = p_workshop_id)
      and (p_part_ids is null or m.part_id = any (p_part_ids))
    group by m.job_card_line_id
  )
  select '6_line_matches_moves', jsonb_build_object(
      'line_id', l.id, 'qty_issued', l.qty_issued, 'issue_moves', coalesce(mv.issued, 0),
      'qty_returned', l.qty_returned, 'return_moves', coalesce(mv.returned, 0))
  from public.job_card_lines l
  left join mv on mv.job_card_line_id = l.id
  where (l.qty_issued <> coalesce(mv.issued, 0) or l.qty_returned <> coalesce(mv.returned, 0))
    and (p_workshop_id is null or l.workshop_id = p_workshop_id)
    and (p_part_ids is null or l.part_id = any (p_part_ids));
end
$$;

create function private.check_invariants()
returns table (invariant text, details jsonb)
language plpgsql
stable
set search_path = ''
as $$
begin
  return query select * from private.check_invariants_for(null, null);

  -- 7. po_lines.qty_accepted / qty_rejected equal their GRN lines.
  return query
  with g as (
    select gl.po_line_id, sum(gl.qty_accepted) as accepted, sum(gl.qty_damaged + gl.qty_wrong_part) as rejected
    from public.grn_lines gl
    group by gl.po_line_id
  )
  select '7_po_line_matches_grns', jsonb_build_object(
      'po_line_id', pl.id, 'qty_accepted', pl.qty_accepted, 'grn_accepted', coalesce(g.accepted, 0),
      'qty_rejected', pl.qty_rejected, 'grn_rejected', coalesce(g.rejected, 0))
  from public.po_lines pl
  left join g on g.po_line_id = pl.id
  where pl.qty_accepted <> coalesce(g.accepted, 0) or pl.qty_rejected <> coalesce(g.rejected, 0);

  -- 8. emergency_in qty = qty_issued + qty_to_stock, per buy.
  return query
  with mv as (
    select m.emergency_buy_id, sum(m.qty) as qty_in
    from public.stock_moves m
    where m.move_type = 'emergency_in' and m.emergency_buy_id is not null
    group by m.emergency_buy_id
  )
  select '8_emergency_in_matches_buy', jsonb_build_object(
      'emergency_buy_id', e.id, 'qty_issued', e.qty_issued, 'qty_to_stock', e.qty_to_stock,
      'emergency_in', coalesce(mv.qty_in, 0))
  from public.emergency_buys e
  left join mv on mv.emergency_buy_id = e.id
  where coalesce(mv.qty_in, 0) <> e.qty_issued + e.qty_to_stock;

  -- 9. parts_complete_at: confirmed cards non-null exactly when complete; draft and cancelled
  --    null; closed non-null.
  return query
  with lines as (
    select l.job_card_id,
      bool_and(l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) = 0) as all_covered
    from public.job_card_lines l
    where l.cancelled_at is null
    group by l.job_card_id
  )
  select '9_parts_complete_at', jsonb_build_object(
      'job_card_id', c.id, 'code', c.code, 'status', c.status, 'parts_complete_at', c.parts_complete_at,
      'needs_review_reason', c.needs_review_reason)
  from public.job_cards c
  left join lines on lines.job_card_id = c.id
  where case c.status
    when 'confirmed' then
      (c.parts_complete_at is not null)
        <> (coalesce(lines.all_covered, true) and c.needs_review_reason is null)
    when 'closed' then c.parts_complete_at is null
    else c.parts_complete_at is not null
  end;
end
$$;

revoke execute on function private.stock_position(uuid, uuid[]) from public, anon;
revoke execute on function private.check_invariants_for(uuid, uuid[]) from public, anon;
revoke execute on function private.check_invariants() from public, anon;
