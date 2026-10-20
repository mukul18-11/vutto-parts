-- Demo seed copy and reset (SPEC §15): private.apply_seed copies the demo_seed template
-- (supabase/seed/template.sql, written by `pnpm seed:gen`) into public, shifting every date by
-- the anchor difference; public.reset_demo (admin) and the scheduled reseed call it.
--
-- Part A of the seed: the planted-scenario checks below leave out the dead-stock count (8–12
-- SKUs), because without the simulated issue history every stocked auto part counts as dead.
-- A later migration re-creates apply_seed with that check.

-- ---------------------------------------------------------------------------------------------
-- apply_seed(p_anchor): the copy. Called by reset_demo, reseed_if_stale, supabase/seed/apply.sql
-- and tests (as postgres). Run SET statement_timeout = '30s' first outside the RPCs.

create function private.apply_seed(p_anchor date)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tables text[] := array_remove(private.reset_tables(), 'stock_balances');
  v_template date;
  v_shift int;
  v_table text;
  v_cols text;
  v_exprs text;
  v_missing text;
  v_n bigint;
  v_flag boolean;
  v_min int;
  v_counts jsonb := '{}';
  v_rows jsonb;
  v_fail jsonb := '[]';
  v_ws record;
begin
  if p_anchor is null then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_anchor'));
  end if;

  -- Wait for running RPCs (they hold the gate shared) and make new ones queue behind the copy.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('demo:gate', 0));
  for v_ws in select w.id from public.workshops w order by w.id loop
    perform private.lock_workshop(v_ws.id);
  end loop;

  -- The template must exist and carry every NOT NULL column without a default.
  if to_regclass('demo_seed.meta') is null then
    perform private.err('DEMO_TEMPLATE_STALE', jsonb_build_object(
      'missing', 'demo_seed.meta', 'hint', 'run pnpm seed:gen and reload the template'));
  end if;
  foreach v_table in array v_tables loop
    if to_regclass(format('demo_seed.%I', v_table)) is null then
      perform private.err('DEMO_TEMPLATE_STALE', jsonb_build_object(
        'missing', 'demo_seed.' || v_table, 'hint', 'run pnpm seed:gen and reload the template'));
    end if;
    select string_agg(c.column_name::text, ', ' order by c.ordinal_position) into v_missing
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = v_table
      and c.is_nullable = 'NO' and c.column_default is null
      and c.is_generated = 'NEVER' and c.is_identity = 'NO'
      and not exists (
        select 1 from information_schema.columns d
        where d.table_schema = 'demo_seed' and d.table_name = v_table and d.column_name = c.column_name
      );
    if v_missing is not null then
      perform private.err('DEMO_TEMPLATE_STALE', jsonb_build_object(
        'table', v_table, 'missing_columns', v_missing, 'hint', 'run pnpm seed:gen and reload the template'));
    end if;
  end loop;

  select m.anchor_date into v_template from demo_seed.meta m;
  v_shift := p_anchor - v_template;

  execute 'truncate table '
    || (select string_agg(format('public.%I', t), ', ') from unnest(private.reset_tables()) as t)
    || ' restart identity';
  truncate table public.idempotency;

  foreach v_table in array v_tables loop
    execute format('alter table public.%I disable trigger user', v_table);
  end loop;

  -- Column lists: the public table's columns without generated and identity columns, that also
  -- exist in demo_seed. Dates and timestamps move by the anchor difference.
  foreach v_table in array v_tables loop
    select
      string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position),
      string_agg(case
          when c.data_type = 'date' then format('s.%I + %s', c.column_name, v_shift)
          when c.data_type = 'timestamp with time zone'
            then format('s.%I + make_interval(days => %s)', c.column_name, v_shift)
          else format('s.%I', c.column_name)
        end, ', ' order by c.ordinal_position)
    into v_cols, v_exprs
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = v_table
      and c.is_generated = 'NEVER' and c.is_identity = 'NO'
      and exists (
        select 1 from information_schema.columns d
        where d.table_schema = 'demo_seed' and d.table_name = v_table and d.column_name = c.column_name
      );
    -- Identity tables keep the seed order, so history order holds and the sequence continues.
    execute format('insert into public.%I (%s) select %s from demo_seed.%I s%s',
      v_table, v_cols, v_exprs, v_table,
      case when v_table in ('stock_moves', 'activity_log') then ' order by s.id' else '' end);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  end loop;

  foreach v_table in array v_tables loop
    execute format('alter table public.%I enable trigger user', v_table);
  end loop;

  -- One-aggregate rebuild of stock_balances from the ledger (the only other writer, SPEC §3.4).
  insert into public.stock_balances (workshop_id, bin_id, part_id, on_hand, created_at)
  select m.workshop_id, x.bin_id, m.part_id, sum(x.qty), min(m.created_at)
  from public.stock_moves m
  cross join lateral (values (m.to_bin_id, m.qty), (m.from_bin_id, -m.qty)) as x (bin_id, qty)
  where x.bin_id is not null
  group by m.workshop_id, x.bin_id, m.part_id;

  -- Document counters continue after the largest seeded number.
  -- (Every UPDATE has a WHERE clause: PostgREST's safeupdate guard applies inside reset_demo.)
  update public.doc_counters dc
  set next_no = coalesce((
      select max(substring(x.code from '([0-9]+)$')::int)
      from (
        select c.workshop_id, 'job_card'::public.doc_type as doc_type, c.code from public.job_cards c
        union all
        select po.workshop_id, 'po'::public.doc_type, po.code from public.purchase_orders po
        union all
        select g.workshop_id, 'grn'::public.doc_type, g.code from public.grns g
      ) x
      where x.workshop_id = dc.workshop_id and x.doc_type = dc.doc_type
    ), 0) + 1
  where dc.workshop_id is not null;

  update public.demo_meta
  set anchor_date = p_anchor, last_reset_at = now(), last_reset_by = auth.uid()
  where id = 1;

  -- SPEC §4 invariants.
  select jsonb_agg(to_jsonb(r)) into v_rows from private.check_invariants() r;
  if v_rows is not null then
    perform private.err('INVARIANT_VIOLATION', jsonb_build_object('rows', v_rows));
  end if;

  -- Planted-scenario minimums per workshop (SPEC §15). Dead stock: see the header note.
  for v_ws in select w.id, w.code from public.workshops w order by w.code loop
    -- 3+ sent POs: one due tomorrow, one 2 days overdue, one partially received with damage.
    select count(*) into v_n from public.purchase_orders po
    where po.workshop_id = v_ws.id and po.status in ('sent', 'partially_received');
    if v_n < 3 then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'sent_pos', 'value', v_n);
    end if;
    if not exists (select 1 from public.purchase_orders po
        where po.workshop_id = v_ws.id and po.status in ('sent', 'partially_received')
          and po.expected_on = p_anchor + 1) then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'po_due_tomorrow');
    end if;
    if not exists (select 1 from public.purchase_orders po
        where po.workshop_id = v_ws.id and po.status in ('sent', 'partially_received')
          and po.expected_on = p_anchor - 2) then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'po_overdue_2_days');
    end if;
    if not exists (select 1 from public.purchase_orders po
        join public.grns g on g.po_id = po.id
        join public.grn_lines gl on gl.grn_id = g.id
        where po.workshop_id = v_ws.id and po.status = 'partially_received' and gl.qty_damaged > 0) then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'po_partially_received_damaged');
    end if;

    -- Stock in receiving waiting for putaway, some of it reserved for a waiting bike.
    if not exists (select 1 from public.stock_balances sb
        join public.bins b on b.id = sb.bin_id
        where sb.workshop_id = v_ws.id and b.kind = 'receiving' and sb.on_hand > 0
          and exists (select 1 from public.job_card_lines l
            join public.job_cards c on c.id = l.job_card_id
            where l.workshop_id = v_ws.id and l.part_id = sb.part_id and l.qty_reserved > 0
              and c.status = 'confirmed')) then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'receiving_reserved');
    end if;

    -- 3+ confirmed cards ready to issue (fully reserved) on bikes at the workshop or in a bay.
    select count(*) into v_n from public.job_cards c
    join public.bikes b on b.id = c.bike_id
    where c.workshop_id = v_ws.id and c.status = 'confirmed' and c.parts_complete_at is not null
      and b.status in ('at_workshop', 'in_repair')
      and exists (select 1 from public.job_card_lines l
        where l.job_card_id = c.id and l.cancelled_at is null and l.qty_reserved > 0);
    if v_n < 3 then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'ready_to_issue', 'value', v_n);
    end if;

    -- Blocked bikes with mixed causes (NCR 6+ with a flagged fitment; JPR 4+).
    v_min := case v_ws.code when 'NCR' then 6 else 4 end;
    select count(*) into v_n from public.v_blocked_bikes bb where bb.workshop_id = v_ws.id;
    if v_n < v_min then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'blocked_bikes', 'value', v_n);
    end if;
    if not exists (select 1 from public.v_missing_parts mp
        join public.v_blocked_bikes bb on bb.job_card_id = mp.job_card_id
        where mp.workshop_id = v_ws.id and mp.eta_status = 'on_po' and not mp.is_overdue) then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'blocked_po_in_transit');
    end if;
    if not exists (select 1 from public.v_missing_parts mp
        join public.v_blocked_bikes bb on bb.job_card_id = mp.job_card_id
        where mp.workshop_id = v_ws.id and mp.eta_status = 'on_po' and mp.is_overdue) then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'blocked_overdue_po');
    end if;
    if not exists (select 1 from public.v_missing_parts mp
        join public.v_blocked_bikes bb on bb.job_card_id = mp.job_card_id
        where mp.workshop_id = v_ws.id and mp.eta_status = 'not_ordered') then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'blocked_not_ordered');
    end if;
    if v_ws.code = 'NCR' and not exists (select 1 from public.v_blocked_bikes bb
        where bb.workshop_id = v_ws.id and bb.needs_review_reason like 'wrong_fitment:%') then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'blocked_flagged_fitment');
    end if;

    -- 3 independent demo chains: an in_repair bike blocked on exactly one part, the only
    -- uncovered line for that part, covered exactly by its own sent, not-overdue PO (one of
    -- them due tomorrow).
    with unc as (
      select l.id, l.job_card_id, l.part_id,
        l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) as uncovered
      from public.job_card_lines l
      join public.job_cards c on c.id = l.job_card_id
      where l.workshop_id = v_ws.id and c.status = 'confirmed' and l.cancelled_at is null
        and l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) > 0
    ),
    chain as (
      select u.part_id, po.expected_on
      from unc u
      join public.job_cards c on c.id = u.job_card_id
      join public.bikes b on b.id = c.bike_id
      join public.po_lines pl on pl.workshop_id = v_ws.id and pl.part_id = u.part_id and pl.open_qty = u.uncovered
      join public.purchase_orders po on po.id = pl.po_id
        and po.status in ('sent', 'partially_received') and po.expected_on >= p_anchor
      where b.status = 'in_repair' and c.needs_review_reason is null
        and (select count(*) from unc u2 where u2.job_card_id = u.job_card_id) = 1
        and (select count(*) from unc u3 where u3.part_id = u.part_id) = 1
        and (select sum(pl2.open_qty) from public.po_lines pl2
          join public.purchase_orders po2 on po2.id = pl2.po_id
          where pl2.workshop_id = v_ws.id and pl2.part_id = u.part_id
            and po2.status in ('draft', 'sent', 'partially_received')) = u.uncovered
    )
    select count(distinct ch.part_id), coalesce(bool_or(ch.expected_on = p_anchor + 1), false)
    into v_n, v_flag
    from chain ch;
    if v_n < 3 or not v_flag then
      v_fail := v_fail || jsonb_build_object(
        'workshop', v_ws.code, 'check', 'demo_chains', 'value', v_n, 'one_due_tomorrow', v_flag);
    end if;

    -- 5+ auto parts at or below their reorder point with no draft or open PO covering them.
    select count(*) into v_n
    from private.po_requirements(v_ws.id, p_anchor) q
    where q.is_auto and q.projected <= q.rop and q.on_order = 0
      and not exists (select 1 from public.po_lines pl
        join public.purchase_orders po on po.id = pl.po_id
        where pl.workshop_id = v_ws.id and pl.part_id = q.part_id and po.status = 'draft');
    if v_n < 5 then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'auto_parts_below_rop', 'value', v_n);
    end if;

    -- 1–2 emergency buys in the last 7 days.
    select count(*) into v_n from public.emergency_buys e
    where e.workshop_id = v_ws.id
      and private.ist_date(e.created_at) between p_anchor - 7 and p_anchor - 1;
    if v_n not between 1 and 2 then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'recent_emergency_buys', 'value', v_n);
    end if;

    -- 1 unsourced part with a live shortfall.
    if not exists (select 1 from public.job_card_lines l
        join public.job_cards c on c.id = l.job_card_id
        join public.parts p on p.id = l.part_id
        left join public.reorder_settings rs on rs.workshop_id = l.workshop_id and rs.part_id = l.part_id
        where l.workshop_id = v_ws.id and c.status = 'confirmed' and l.cancelled_at is null
          and l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) > 0
          and coalesce(rs.preferred_supplier_id, p.preferred_supplier_id) is null) then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'unsourced_shortfall');
    end if;

    -- 1 bike with an unknown variant and an unresolved finding on a draft card.
    if not exists (select 1 from public.bikes b
        join public.job_cards c on c.bike_id = b.id and c.status = 'draft'
        join public.inspection_findings f on f.bike_id = b.id
        where b.workshop_id = v_ws.id and b.variant_id is null
          and f.job_card_line_id is null and f.no_part_reason is null) then
      v_fail := v_fail || jsonb_build_object('workshop', v_ws.code, 'check', 'unknown_variant_unresolved');
    end if;
  end loop;

  -- 1 part with a flagged fitment (fitments are shared master data).
  select count(distinct f.part_id) into v_n from public.part_fitments f
  where f.flagged_count >= greatest(1, f.confirmed_count);
  if v_n <> 1 then
    v_fail := v_fail || jsonb_build_object('check', 'flagged_fitment', 'value', v_n);
  end if;

  if jsonb_array_length(v_fail) > 0 then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'planted_scenarios', 'failures', v_fail));
  end if;

  return jsonb_build_object('anchor_date', p_anchor, 'shift_days', v_shift, 'rows', v_counts);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- reset_demo (admin): exempt from the RPC steps (no request_id; the try-lock and the cooldown
-- stop double submits). Its own statement_timeout is hoisted by PostgREST (SPEC §15).

create function public.reset_demo()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
set lock_timeout = '10s'
as $$
declare
  v_meta public.demo_meta;
  v_until timestamptz;
begin
  perform private.authorize('admin', null);

  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('demo:reset', 0)) then
    perform private.err('RESET_IN_PROGRESS');
  end if;

  select * into v_meta from public.demo_meta where id = 1;
  v_until := v_meta.last_reset_at + make_interval(secs => v_meta.cooldown_seconds);
  if v_until is not null and now() < v_until then
    perform private.err('RESET_COOLDOWN', jsonb_build_object(
      'retry_after_seconds', ceil(extract(epoch from v_until - now()))::int));
  end if;

  return private.apply_seed(private.ist_today());
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Scheduled reseed (SPEC §15): only when the anchor is stale, nobody wrote anything in the last
-- 24 hours, and it is night in India (outside 08:00–22:00 IST).

create function private.reseed_due(p_now timestamptz, p_anchor date, p_last_activity timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_anchor is null or p_anchor < private.ist_date(p_now))
    and (p_last_activity is null or p_last_activity <= p_now - interval '24 hours')
    and extract(hour from (p_now at time zone 'Asia/Kolkata')) not between 8 and 21
$$;

create function private.reseed_if_stale(p_now timestamptz default now())
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_anchor date;
  v_last timestamptz;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('demo:reset', 0)) then
    return false;
  end if;
  select m.anchor_date into v_anchor from public.demo_meta m where m.id = 1;
  select max(i.created_at) into v_last from public.idempotency i;
  if not private.reseed_due(p_now, v_anchor, v_last) then
    return false;
  end if;
  perform private.apply_seed(private.ist_today());
  return true;
end
$$;

-- Called by the demo-guard GitHub Action with the secret key (service_role only, SPEC §11.2).
create function public.reseed_if_stale_service()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
set lock_timeout = '10s'
as $$
begin
  return jsonb_build_object('reseeded', private.reseed_if_stale());
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Supabase limits authenticated to 8 s; reset_demo carries its own 30 s (SPEC §15).

alter role authenticated set statement_timeout = '20s';
notify pgrst, 'reload config';

-- ---------------------------------------------------------------------------------------------
-- Function grants (SPEC §11.2).

revoke execute on function private.apply_seed(date) from public, anon;
revoke execute on function public.reset_demo() from public, anon;
revoke execute on function private.reseed_due(timestamptz, date, timestamptz) from public, anon;
revoke execute on function private.reseed_if_stale(timestamptz) from public, anon;
revoke execute on function public.reseed_if_stale_service() from public, anon, authenticated;

grant execute on function public.reset_demo() to authenticated;
grant execute on function public.reseed_if_stale_service() to service_role;
