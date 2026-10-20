-- Read SQL for the manager screens (CLAUDE.md rule 12): the blocked board KPI strip, the bikes
-- list, a job card's findings with their applicable part type, and a job card's history. All
-- read-only: security_invoker views and SECURITY INVOKER functions, so RLS limits every row to the
-- caller's workshops. Aggregates are computed here, never in TypeScript (SPEC §10).

-- ---------------------------------------------------------------------------------------------
-- Blocked board KPI strip. The week is Monday to p_as_of (IST), the workshops' Mon–Sat week.
-- avg_wait_hours is the mean time since waiting_since over the bikes on the board right now.
-- p_workshop_id null = every workshop the caller can see (admin).

create function public.blocked_board_kpis(
  p_workshop_id uuid,
  p_as_of date default private.ist_today()
)
returns table (
  blocked_n int,
  avg_wait_hours numeric,
  week_start date,
  emergency_week_n int,
  emergency_week_paise bigint,
  po_overdue_n int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with wk as (
    select p_as_of - (extract(isodow from p_as_of)::int - 1) as start
  ),
  bb as (
    select
      count(*) as n,
      avg(extract(epoch from (now() - b.waiting_since)) / 3600.0) as avg_hours
    from public.v_blocked_bikes b
    where p_workshop_id is null or b.workshop_id = p_workshop_id
  ),
  eb as (
    select count(*) as n, coalesce(sum(e.total_paise), 0) as paise
    from public.v_emergency_buys_list e, wk
    where e.bought_on between wk.start and p_as_of
      and (p_workshop_id is null or e.workshop_id = p_workshop_id)
  ),
  po as (
    select count(*) as n
    from public.purchase_orders o
    where o.status in ('sent', 'partially_received')
      and o.expected_on < p_as_of
      and (p_workshop_id is null or o.workshop_id = p_workshop_id)
  )
  select
    bb.n::int,
    round(bb.avg_hours::numeric, 1),
    wk.start,
    eb.n::int,
    eb.paise::bigint,
    po.n::int
  from bb, wk, eb, po
$$;

-- ---------------------------------------------------------------------------------------------
-- Bikes list: one row per bike with its model, variant and current job card (the open draft or
-- confirmed card, else the most recent one). Paginated by keyset on (purchased_at desc, id desc).

create view public.v_bike_list
with (security_invoker = true)
as
select
  b.id,
  b.workshop_id,
  b.reg_no,
  b.reg_no_norm,
  b.model_id,
  vm.make,
  vm.model,
  b.variant_id,
  mv.name as variant_name,
  b.mfg_year,
  b.status,
  b.purchased_at,
  b.arrived_at,
  b.is_simulated,
  c.id as card_id,
  c.code as card_code,
  c.status as card_status
from public.bikes b
join public.vehicle_models vm on vm.id = b.model_id
left join public.model_variants mv on mv.id = b.variant_id
left join lateral (
  select jc.id, jc.code, jc.status
  from public.job_cards jc
  where jc.bike_id = b.id
  order by (jc.status in ('draft', 'confirmed')) desc, jc.created_at desc, jc.id desc
  limit 1
) c on true;

grant select on public.v_bike_list to authenticated;

create index bikes_workshop_purchased_idx on public.bikes (workshop_id, purchased_at desc, id desc);

-- ---------------------------------------------------------------------------------------------
-- A job card's findings (the findings of its bike) with the finding type and the part type of the
-- applicable finding_type_parts row (SPEC §9.1 step 1, the same match finding_candidates uses):
-- attr_key null, or the bike's attribute equals attr_value; unknown variant matches only null or
-- segment rows. applicable_part_type is null when no row applies (the picker then shows all parts).

create view public.v_job_card_findings
with (security_invoker = true)
as
select
  c.id as job_card_id,
  f.id,
  f.workshop_id,
  f.bike_id,
  f.finding_type_id,
  ft.code,
  ft.label_en,
  ft.label_hi,
  ft.area,
  f.qty,
  f.notes,
  f.job_card_line_id,
  f.no_part_reason,
  ftp.part_type as applicable_part_type,
  f.created_at
from public.job_cards c
join public.inspection_findings f on f.bike_id = c.bike_id
join public.finding_types ft on ft.id = f.finding_type_id
join public.bikes b on b.id = f.bike_id
join public.vehicle_models m on m.id = b.model_id
left join public.model_variants v on v.id = b.variant_id
left join lateral (
  select t.part_type
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
) ftp on true;

grant select on public.v_job_card_findings to authenticated;

-- ---------------------------------------------------------------------------------------------
-- A job card's history from activity_log, newest first: rows about the card, its bike, its lines
-- (cancelled ones included; a reallocation is logged on the receiving line, so the giving line is
-- matched through summary.from), its bike's findings, and emergency buys on its lines. Names come
-- from profiles under RLS.

create function public.job_card_history(p_card_id uuid)
returns table (
  id bigint,
  created_at timestamptz,
  action text,
  entity_type text,
  user_id uuid,
  user_full_name text,
  summary jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with card as (
    select c.id, c.bike_id from public.job_cards c where c.id = p_card_id
  ),
  lines as (
    select l.id from public.job_card_lines l where l.job_card_id = p_card_id
  ),
  findings as (
    select f.id from public.inspection_findings f join card on card.bike_id = f.bike_id
  ),
  hits as (
    select a.id from public.activity_log a join card on a.entity_id = card.id
    where a.entity_type = 'job_card'
    union
    select a.id from public.activity_log a join card on a.entity_id = card.bike_id
    where a.entity_type = 'bike'
    union
    select a.id from public.activity_log a join lines on a.entity_id = lines.id
    where a.entity_type = 'job_card_line'
    union
    select a.id from public.activity_log a join lines on (a.summary -> 'from' ->> 'line_id')::uuid = lines.id
    where a.entity_type = 'job_card_line' and a.action = 'reallocate_reservation'
    union
    select a.id from public.activity_log a join findings on a.entity_id = findings.id
    where a.entity_type = 'inspection_finding'
    union
    select a.id from public.activity_log a join lines on (a.summary -> 'line' ->> 'line_id')::uuid = lines.id
    where a.entity_type = 'emergency_buy'
  )
  select a.id, a.created_at, a.action, a.entity_type, a.user_id, p.full_name, a.summary
  from public.activity_log a
  join hits h on h.id = a.id
  left join public.profiles p on p.user_id = a.user_id
  order by a.id desc
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function public.blocked_board_kpis(uuid, date) from public, anon;
revoke execute on function public.job_card_history(uuid) from public, anon;

grant execute on function public.blocked_board_kpis(uuid, date) to authenticated;
grant execute on function public.job_card_history(uuid) to authenticated;
