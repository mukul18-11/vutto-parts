-- Foundation: schema private, extensions, default grants (SPEC §11.2), time and error helpers,
-- idempotency, health(), workshops, doc_counters, demo_meta, app_errors.
-- Policies for these tables are created in the master migration, once the role helpers exist.

create schema if not exists private;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- SPEC §11.2, exactly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

grant usage on schema private to authenticated;

-- SPEC §12: no GraphQL API, no Realtime tables.
drop extension if exists pg_graphql;

do $$
declare
  r record;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for r in
      select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime'
    loop
      execute format('alter publication supabase_realtime drop table %I.%I', r.schemaname, r.tablename);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Time (SPEC §13). The database timezone stays UTC.

create function private.ist_date(p_ts timestamptz)
returns date
language sql
immutable
as $$
  select (p_ts at time zone 'Asia/Kolkata')::date
$$;

create function private.ist_today()
returns date
language sql
stable
as $$
  select private.ist_date(now())
$$;

-- ---------------------------------------------------------------------------------------------
-- Errors (SPEC §11.4). RAISE fails on a NULL DETAIL, hence the coalesce.

create function private.err(p_code text, p_detail jsonb default '{}')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail = coalesce(p_detail, '{}'::jsonb)::text;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Workshop lock (SPEC §11.1 step 4). Transaction-level only.

create function private.lock_workshop(p_workshop_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ws:' || p_workshop_id::text, 0));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Idempotency (SPEC §3.5, §11.1 steps 1 and 7). RLS on, no policies: clients cannot read it.

create table public.idempotency (
  user_id uuid not null,
  request_id uuid not null,
  fn text not null,
  payload_hash text not null,
  result jsonb null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.idempotency enable row level security;
grant select on public.idempotency to authenticated;

-- Returns the stored result of a completed identical call, or null for a new call.
create function private.begin_request(p_fn text, p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid;
  v_hash text;
  v_row public.idempotency;
begin
  -- Shared gate: a demo reset takes it exclusively (SPEC §15).
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('demo:gate', 0));

  v_uid := auth.uid();
  if v_uid is null then
    perform private.err('NOT_AUTHENTICATED');
  end if;
  if p_request_id is null then
    perform private.err('VALIDATION', jsonb_build_object('field', 'p_request_id'));
  end if;

  -- jsonb text output is canonical (keys sorted, duplicates removed, fixed spacing).
  v_hash := md5(coalesce(p_payload, 'null'::jsonb)::text);

  insert into public.idempotency (user_id, request_id, fn, payload_hash)
  values (v_uid, p_request_id, p_fn, v_hash)
  on conflict do nothing;
  if found then
    return null;
  end if;

  -- A concurrent duplicate waited on the primary key above; this read sees the committed row.
  select * into v_row
  from public.idempotency
  where user_id = v_uid and request_id = p_request_id;

  if v_row.fn is distinct from p_fn or v_row.payload_hash is distinct from v_hash then
    perform private.err('IDEMPOTENCY_KEY_REUSED');
  end if;
  return v_row.result;
end
$$;

-- Stores the result and returns it, so an RPC can end with: return private.finish_request(...).
create function private.finish_request(p_fn text, p_request_id uuid, p_result jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if p_result is null then
    raise exception 'finish_request: result must not be null';
  end if;
  update public.idempotency
  set result = p_result
  where user_id = auth.uid() and request_id = p_request_id and fn = p_fn;
  if not found then
    raise exception 'finish_request: no idempotency row for % %', p_fn, p_request_id;
  end if;
  return p_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Master: workshops (fixed ids, never truncated) and document counters.

create table public.workshops (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('NCR', 'JPR')),
  name text not null,
  city text not null,
  created_at timestamptz not null default now()
);
alter table public.workshops enable row level security;
grant select on public.workshops to authenticated;

insert into public.workshops (id, code, name, city) values
  ('00000000-0000-0000-0000-0000000000a1', 'NCR', 'Delhi NCR', 'Delhi NCR'),
  ('00000000-0000-0000-0000-0000000000a2', 'JPR', 'Jaipur', 'Jaipur');

create type public.doc_type as enum ('job_card', 'po', 'grn');

create table public.doc_counters (
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  doc_type public.doc_type not null,
  next_no int not null default 1 check (next_no >= 1),
  created_at timestamptz not null default now(),
  primary key (workshop_id, doc_type)
);
alter table public.doc_counters enable row level security;
grant select on public.doc_counters to authenticated;

insert into public.doc_counters (workshop_id, doc_type, next_no)
select w.id, t.doc_type, 1
from public.workshops w
cross join unnest(enum_range(null::public.doc_type)) as t (doc_type);

-- ---------------------------------------------------------------------------------------------
-- System tables (SPEC §3.5).

create table public.demo_meta (
  id int primary key check (id = 1),
  anchor_date date null,
  last_reset_at timestamptz null,
  last_reset_by uuid null,
  cooldown_seconds int not null default 120,
  created_at timestamptz not null default now()
);
alter table public.demo_meta enable row level security;
grant select on public.demo_meta to authenticated;

insert into public.demo_meta (id) values (1);

create table public.app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null,
  route text not null,
  code text not null,
  message text not null,
  request_id uuid null
);
alter table public.app_errors enable row level security;
grant select on public.app_errors to authenticated;

-- ---------------------------------------------------------------------------------------------
-- public.health() (SPEC §11.1, §16): the one SECURITY DEFINER read RPC. anon has no access to
-- supabase_migrations, so the function reads it as its owner and returns only these two fields.

create function public.health()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', (select max(version) from supabase_migrations.schema_migrations)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Function grants.

revoke execute on function private.ist_date(timestamptz) from public, anon;
revoke execute on function private.ist_today() from public, anon;
revoke execute on function private.err(text, jsonb) from public, anon;
revoke execute on function private.lock_workshop(uuid) from public, anon;
revoke execute on function private.begin_request(text, uuid, jsonb) from public, anon;
revoke execute on function private.finish_request(text, uuid, jsonb) from public, anon;
revoke execute on function public.health() from public, anon;

grant execute on function private.ist_date(timestamptz) to authenticated;
grant execute on function private.ist_today() to authenticated;
grant execute on function public.health() to anon, authenticated;
