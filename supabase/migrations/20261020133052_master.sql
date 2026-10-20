-- Master data (SPEC §3.1): profiles and the role helpers, authorize(), catalogue, suppliers,
-- bins, reorder settings. RLS policies for these tables and for the foundation tables (§11.3).

-- ---------------------------------------------------------------------------------------------
-- Profiles and role helpers. Role and workshop come only from public.profiles (SPEC §2).

-- Ascending order, so private.authorize can compare role >= min_role.
create type public.app_role as enum ('store_keeper', 'manager', 'admin');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.app_role not null,
  workshop_id uuid null references public.workshops (id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((role = 'admin') = (workshop_id is null))
);
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;

create index profiles_workshop_id_idx on public.profiles (workshop_id);

create function private.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.user_id = auth.uid()
$$;

create function private.my_workshop_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.workshop_id from public.profiles p where p.user_id = auth.uid()
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.user_id = auth.uid()), false)
$$;

-- SPEC §11.1 step 3. Admin passes any workshop; workshops are compared with IS DISTINCT FROM.
create function private.authorize(p_min_role public.app_role, p_workshop_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    perform private.err('NOT_AUTHENTICATED');
  end if;
  select * into v_profile from public.profiles where user_id = v_uid;
  if not found then
    perform private.err('NO_PROFILE');
  end if;
  if v_profile.role < p_min_role then
    perform private.err('FORBIDDEN');
  end if;
  if v_profile.role <> 'admin' and v_profile.workshop_id is distinct from p_workshop_id then
    perform private.err('NOT_FOUND');
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Enums.

create type public.supplier_kind as enum ('oem_dealer', 'wholesaler', 'local_market');
create type public.vehicle_segment as enum ('motorcycle', 'scooter', 'moped');
create type public.brake_type as enum ('drum', 'disc');
create type public.start_type as enum ('kick', 'self', 'kick_self');
create type public.wheel_type as enum ('spoke', 'alloy', 'steel');
create type public.emission_norm as enum ('bs3', 'bs4', 'bs6', 'bs6_obd2', 'bs6_obd2b');
create type public.fuel_system as enum ('carb', 'fi', 'ei');
create type public.part_category as enum ('consumable', 'wear', 'model_specific');
create type public.uom as enum ('pcs', 'set', 'pair', 'bottle', 'kit');
create type public.fitment_source as enum ('catalogue', 'learned');
create type public.finding_area as enum ('engine', 'brakes', 'drivetrain', 'electrical', 'body', 'tyres_suspension');
create type public.bin_kind as enum ('normal', 'receiving', 'quarantine');

-- ---------------------------------------------------------------------------------------------
-- Catalogue and suppliers.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  phone text not null,
  kind public.supplier_kind not null,
  lead_time_days int not null check (lead_time_days between 0 and 30),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.vehicle_models (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text not null,
  segment public.vehicle_segment not null,
  created_at timestamptz not null default now(),
  unique (make, model)
);

create table public.model_variants (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.vehicle_models (id) on delete restrict,
  name text not null,
  year_from int not null,
  year_to int null,
  brake_front public.brake_type not null,
  brake_rear public.brake_type not null,
  start_type public.start_type not null,
  wheels public.wheel_type not null,
  emission public.emission_norm not null,
  fuel public.fuel_system not null,
  created_at timestamptz not null default now(),
  check (year_to is null or year_to >= year_from)
);
create index model_variants_model_id_idx on public.model_variants (model_id);

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  name_hi text null,
  aliases text[] not null default '{}',
  oem_part_no text null,
  oem_part_no_norm text generated always as (upper(regexp_replace(oem_part_no, '[^A-Za-z0-9]', '', 'g'))) stored,
  category public.part_category not null,
  part_type text not null,
  uom public.uom not null,
  standard_price_paise bigint not null check (standard_price_paise > 0),
  preferred_supplier_id uuid null references public.suppliers (id) on delete restrict,
  is_universal boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index parts_part_type_idx on public.parts (part_type);

create table public.part_fitments (
  part_id uuid not null references public.parts (id) on delete restrict,
  variant_id uuid not null references public.model_variants (id) on delete restrict,
  qty_per_bike int not null default 1 check (qty_per_bike > 0),
  source public.fitment_source not null,
  confirmed_count int not null default 0 check (confirmed_count >= 0),
  flagged_count int not null default 0 check (flagged_count >= 0),
  last_flag_note text null,
  last_flagged_at timestamptz null,
  created_at timestamptz not null default now(),
  primary key (part_id, variant_id)
);
create index part_fitments_variant_id_idx on public.part_fitments (variant_id);

create table public.supplier_parts (
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  part_id uuid not null references public.parts (id) on delete restrict,
  supplier_code text null,
  price_paise bigint not null check (price_paise > 0),
  created_at timestamptz not null default now(),
  primary key (supplier_id, part_id)
);
create index supplier_parts_part_id_idx on public.supplier_parts (part_id);

create table public.finding_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label_en text not null,
  label_hi text not null,
  area public.finding_area not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.finding_type_parts (
  id uuid primary key default gen_random_uuid(),
  finding_type_id uuid not null references public.finding_types (id) on delete restrict,
  part_type text not null,
  qty int not null check (qty > 0),
  attr_key text null check (attr_key in ('segment', 'brake_front', 'brake_rear', 'start_type', 'wheels', 'emission', 'fuel')),
  attr_value text null,
  created_at timestamptz not null default now(),
  check ((attr_key is null) = (attr_value is null))
);
create index finding_type_parts_finding_type_id_idx on public.finding_type_parts (finding_type_id);

-- A finding resolves to at most one part on any bike (SPEC §3.1): a finding type has either
-- exactly one row with attr_key NULL, or rows that all use one attr_key with distinct values.
create function private.finding_type_parts_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_labels text[];
  v_n int;
  v_null int;
  v_keys int;
  v_values int;
begin
  if new.attr_key is not null then
    v_labels := case new.attr_key
      when 'segment' then enum_range(null::public.vehicle_segment)::text[]
      when 'brake_front' then enum_range(null::public.brake_type)::text[]
      when 'brake_rear' then enum_range(null::public.brake_type)::text[]
      when 'start_type' then enum_range(null::public.start_type)::text[]
      when 'wheels' then enum_range(null::public.wheel_type)::text[]
      when 'emission' then enum_range(null::public.emission_norm)::text[]
      when 'fuel' then enum_range(null::public.fuel_system)::text[]
    end;
    if not (new.attr_value = any (v_labels)) then
      perform private.err('VALIDATION', jsonb_build_object(
        'reason', 'attr_value_invalid', 'attr_key', new.attr_key, 'attr_value', new.attr_value));
    end if;
  end if;

  -- Serialise concurrent edits of the same finding type.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ftp:' || new.finding_type_id::text, 0));

  select count(*), count(*) filter (where attr_key is null), count(distinct attr_key), count(distinct attr_value)
  into v_n, v_null, v_keys, v_values
  from public.finding_type_parts
  where finding_type_id = new.finding_type_id;

  if not ((v_n = 1 and v_null = 1) or (v_null = 0 and v_keys = 1 and v_values = v_n)) then
    perform private.err('VALIDATION', jsonb_build_object(
      'reason', 'finding_type_parts_ambiguous', 'finding_type_id', new.finding_type_id));
  end if;
  return null;
end
$$;

create trigger finding_type_parts_check
after insert or update on public.finding_type_parts
for each row execute function private.finding_type_parts_check();

-- ---------------------------------------------------------------------------------------------
-- Bins. The QR label holds exactly the code, so code, kind and workshop never change.

create table public.bins (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  code text not null unique check (code ~ '^(NCR|JPR)-([A-Z][0-9]{2}-[0-9]{2}|RCV|QRN)$'),
  kind public.bin_kind not null,
  is_active boolean not null default true,
  count_requested_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (workshop_id, id)
);
create unique index bins_one_receiving_per_workshop on public.bins (workshop_id) where kind = 'receiving';
create unique index bins_one_quarantine_per_workshop on public.bins (workshop_id) where kind = 'quarantine';

-- The code's prefix is the workshop's code; RCV is the receiving bin, QRN the quarantine bin.
create function private.bins_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ws_code text;
  v_kind public.bin_kind;
begin
  select w.code into v_ws_code from public.workshops w where w.id = new.workshop_id;
  v_kind := case split_part(new.code, '-', 2)
    when 'RCV' then 'receiving'::public.bin_kind
    when 'QRN' then 'quarantine'::public.bin_kind
    else 'normal'::public.bin_kind
  end;
  if v_ws_code is distinct from split_part(new.code, '-', 1) or new.kind is distinct from v_kind then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'bin_code_mismatch', 'code', new.code));
  end if;
  return new;
end
$$;

create trigger bins_before_insert
before insert on public.bins
for each row execute function private.bins_before_insert();

create function private.bins_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code
     or new.kind is distinct from old.kind
     or new.workshop_id is distinct from old.workshop_id then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'bin_immutable', 'code', old.code));
  end if;
  -- stock_balances is created in the ledger migration; plpgsql resolves it at run time.
  if old.is_active and not new.is_active
     and exists (select 1 from public.stock_balances b where b.bin_id = old.id and b.on_hand > 0) then
    perform private.err('VALIDATION', jsonb_build_object('reason', 'bin_holds_stock', 'code', old.code));
  end if;
  return new;
end
$$;

create trigger bins_before_update
before update on public.bins
for each row execute function private.bins_before_update();

create table public.reorder_settings (
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  part_id uuid not null references public.parts (id) on delete restrict,
  auto boolean not null,
  safety_stock int not null check (safety_stock >= 0),
  max_qty int not null check (max_qty > 0),
  preferred_supplier_id uuid null references public.suppliers (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (workshop_id, part_id)
);
create index reorder_settings_part_id_idx on public.reorder_settings (part_id);

-- ---------------------------------------------------------------------------------------------
-- RLS (SPEC §11.3). Every table has RLS on; all policies are TO authenticated.

alter table public.suppliers enable row level security;
alter table public.vehicle_models enable row level security;
alter table public.model_variants enable row level security;
alter table public.parts enable row level security;
alter table public.part_fitments enable row level security;
alter table public.supplier_parts enable row level security;
alter table public.finding_types enable row level security;
alter table public.finding_type_parts enable row level security;
alter table public.bins enable row level security;
alter table public.reorder_settings enable row level security;

-- Foundation tables. idempotency and doc_counters have no policies.
create policy workshops_select on public.workshops
  for select to authenticated using (true);
create policy demo_meta_select on public.demo_meta
  for select to authenticated using (true);
create policy app_errors_select on public.app_errors
  for select to authenticated using ((select private.is_admin()));

-- Own row, same-workshop rows, admin rows (so names show), or all for admin.
create policy profiles_select on public.profiles
  for select to authenticated using (
    user_id = (select auth.uid())
    or (select private.is_admin())
    or workshop_id = (select private.my_workshop_id())
    or role = 'admin'
  );

-- Master data without a workshop_id: everyone reads, admin writes.
do $$
declare
  t text;
begin
  foreach t in array array[
    'suppliers', 'vehicle_models', 'model_variants', 'parts', 'part_fitments',
    'supplier_parts', 'finding_types', 'finding_type_parts'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_admin()))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))',
      t || '_update', t);
  end loop;
end $$;

create policy bins_select on public.bins
  for select to authenticated
  using ((select private.is_admin()) or workshop_id = (select private.my_workshop_id()));
create policy bins_insert on public.bins
  for insert to authenticated with check ((select private.is_admin()));
create policy bins_update on public.bins
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy reorder_settings_select on public.reorder_settings
  for select to authenticated
  using ((select private.is_admin()) or workshop_id = (select private.my_workshop_id()));
create policy reorder_settings_insert on public.reorder_settings
  for insert to authenticated
  with check (
    (select private.is_admin())
    or (workshop_id = (select private.my_workshop_id()) and (select private.my_role()) = 'manager')
  );
create policy reorder_settings_update on public.reorder_settings
  for update to authenticated
  using (
    (select private.is_admin())
    or (workshop_id = (select private.my_workshop_id()) and (select private.my_role()) = 'manager')
  )
  with check (
    (select private.is_admin())
    or (workshop_id = (select private.my_workshop_id()) and (select private.my_role()) = 'manager')
  );

-- ---------------------------------------------------------------------------------------------
-- Table grants (SPEC §11.2): SELECT on every table; INSERT/UPDATE on master data behind RLS.

grant select on public.suppliers, public.vehicle_models, public.model_variants, public.parts,
  public.part_fitments, public.supplier_parts, public.finding_types, public.finding_type_parts,
  public.bins, public.reorder_settings to authenticated;
grant insert, update on public.suppliers, public.vehicle_models, public.model_variants, public.parts,
  public.part_fitments, public.supplier_parts, public.finding_types, public.finding_type_parts,
  public.bins, public.reorder_settings to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Function grants.

revoke execute on function private.my_role() from public, anon;
revoke execute on function private.my_workshop_id() from public, anon;
revoke execute on function private.is_admin() from public, anon;
revoke execute on function private.authorize(public.app_role, uuid) from public, anon;
revoke execute on function private.finding_type_parts_check() from public, anon;
revoke execute on function private.bins_before_insert() from public, anon;
revoke execute on function private.bins_before_update() from public, anon;

grant execute on function private.my_role() to authenticated;
grant execute on function private.my_workshop_id() to authenticated;
grant execute on function private.is_admin() to authenticated;
