// Security catalog checks as postgres (SPEC §17).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import allowlist from "./rpc-allowlist.json";
import { pgClient } from "./clients";

const MIGRATIONS_DIR = path.resolve("supabase/migrations");

// SPEC §11.2: the only private functions clients may execute.
const PRIVATE_CLIENT_FUNCTIONS = [
  "ist_date",
  "ist_today",
  "is_admin",
  "my_role",
  "my_workshop_id",
  "parts_search_text",
  "po_requirements",
];

let db: pg.Client;

beforeAll(async () => {
  db = await pgClient();
});

afterAll(async () => {
  await db?.end();
});

async function rows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await db.query(sql)).rows as T[];
}

// Functions owned by an extension are not ours to police.
const OWN_FUNCTIONS = `
  select p.oid, n.nspname, p.proname, p.prosecdef, p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

describe("security catalog", () => {
  it("has no public table without RLS", async () => {
    const bad = await rows(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
    expect(bad).toEqual([]);
  });

  it("has no public view without security_invoker", async () => {
    const bad = await rows(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and not coalesce(c.reloptions @> array['security_invoker=true']
                      or c.reloptions @> array['security_invoker=on'], false)`);
    expect(bad).toEqual([]);
  });

  it("lets authenticated SELECT every public view", async () => {
    const bad = await rows(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and not has_table_privilege('authenticated', c.oid, 'SELECT')`);
    expect(bad).toEqual([]);
  });

  it("has no materialized view in public", async () => {
    const bad = await rows(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'm'`);
    expect(bad).toEqual([]);
  });

  it("sets search_path on every SECURITY DEFINER function", async () => {
    const bad = await rows(`
      select nspname, proname from (${OWN_FUNCTIONS}) f
      where prosecdef
        and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')`);
    expect(bad).toEqual([]);
  });

  it("has no function in public or private executable by PUBLIC", async () => {
    const bad = await rows(`
      select nspname, proname from (${OWN_FUNCTIONS}) f
      where has_function_privilege('public', oid, 'EXECUTE')`);
    expect(bad).toEqual([]);
  });

  it("lets anon execute only public.health", async () => {
    const fns = await rows<{ proname: string }>(`
      select proname from (${OWN_FUNCTIONS}) f
      where has_function_privilege('anon', oid, 'EXECUTE') order by 1`);
    expect(fns.map((f) => f.proname)).toEqual(["health"]);
  });

  it("does not let authenticated execute reseed_if_stale_service", async () => {
    const bad = await rows(`
      select proname from (${OWN_FUNCTIONS}) f
      where proname = 'reseed_if_stale_service' and has_function_privilege('authenticated', oid, 'EXECUTE')`);
    expect(bad).toEqual([]);
  });

  it("has exactly the allowlisted public functions, without overloads", async () => {
    const fns = await rows<{ proname: string }>(`
      select proname from (${OWN_FUNCTIONS}) f where nspname = 'public' order by 1`);
    const names = fns.map((f) => f.proname);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...allowlist].sort());
  });

  it("lets authenticated execute only the SPEC §11.2 private functions", async () => {
    const fns = await rows<{ proname: string }>(`
      select proname from (${OWN_FUNCTIONS}) f
      where nspname = 'private' and has_function_privilege('authenticated', oid, 'EXECUTE')`);
    for (const f of fns) expect(PRIVATE_CLIENT_FUNCTIONS).toContain(f.proname);
  });

  it("has no table in the supabase_realtime publication", async () => {
    const bad = await rows(`select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
    expect(bad).toEqual([]);
  });

  it("has no migration that mentions user or app metadata", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
    const bad = files.filter((f) => /user_metadata|app_metadata/.test(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")));
    expect(bad).toEqual([]);
  });
});
