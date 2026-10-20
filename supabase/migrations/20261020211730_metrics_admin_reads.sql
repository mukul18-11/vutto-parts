-- Read SQL for the metrics and dead stock screens (Prompt 13, SPEC §10). Both functions are
-- SECURITY INVOKER, so RLS scopes them; p_workshop_id null = every visible workshop.

-- ---------------------------------------------------------------------------------------------
-- Dead stock list: dead_stock() (the one definition of the rule) plus the age of the dead-stock
-- clock and the latest move of any type. age_days counts IST days since the last issue, grn or
-- emergency_in move (null when the part was never issued or received here); the last move may be a
-- putaway, move, adjust or return, which never reset the age.

create function public.dead_stock_list(
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
  last_activity_at timestamptz,
  age_days int,
  last_move_type public.move_type,
  last_move_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.workshop_id, d.part_id, d.sku, d.name, d.uom, d.available, d.dead_qty, d.unit_price_paise,
    d.price_source, d.value_paise, d.last_activity_at,
    (p_as_of - private.ist_date(d.last_activity_at))::int,
    lm.move_type, lm.created_at
  from public.dead_stock(p_workshop_id, p_as_of, p_days) d
  left join lateral (
    select m.move_type, m.created_at
    from public.stock_moves m
    where m.workshop_id = d.workshop_id
      and m.part_id = d.part_id
      and private.ist_date(m.created_at) <= p_as_of
    order by m.id desc
    limit 1
  ) lm on true
  order by d.value_paise desc, d.sku
$$;

-- ---------------------------------------------------------------------------------------------
-- Wrong-fit returns: the list behind the wrong-fit rate (SPEC §10): return_to_stock moves with
-- reason 'wrong_fitment' whose IST day is in p_from..p_to, newest first. sum(qty) equals
-- kpis().wrong_fit_qty for the same arguments.

create function public.wrong_fit_returns(
  p_workshop_id uuid,
  p_from date,
  p_to date
)
returns table (
  move_id bigint,
  workshop_id uuid,
  created_at timestamptz,
  job_card_id uuid,
  card_code text,
  reg_no text,
  part_id uuid,
  sku text,
  part_name text,
  uom public.uom,
  qty int,
  note text,
  user_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.workshop_id, m.created_at, c.id, c.code, b.reg_no, p.id, p.sku, p.name, p.uom, m.qty,
    m.note, pr.full_name
  from public.stock_moves m
  join public.parts p on p.id = m.part_id
  left join public.job_card_lines l on l.id = m.job_card_line_id
  left join public.job_cards c on c.id = l.job_card_id
  left join public.bikes b on b.id = c.bike_id
  left join public.profiles pr on pr.user_id = m.user_id
  where m.move_type = 'return_to_stock'
    and m.reason = 'wrong_fitment'
    and private.ist_date(m.created_at) between p_from and p_to
    and (p_workshop_id is null or m.workshop_id = p_workshop_id)
  order by m.created_at desc, m.id desc
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function public.dead_stock_list(uuid, date, int) from public, anon;
revoke execute on function public.wrong_fit_returns(uuid, date, date) from public, anon;

grant execute on function public.dead_stock_list(uuid, date, int) to authenticated;
grant execute on function public.wrong_fit_returns(uuid, date, date) to authenticated;
