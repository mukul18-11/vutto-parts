// Production smoke test (SPEC §12, §16). Read-only checks against the deployed app and the hosted
// Supabase project, using only the publishable key (never the secret key):
//   - /api/health is ok and reports the newest migration in supabase/migrations
//   - /login returns 200
//   - signUp and anonymous sign-in are refused
//   - each demo login works and its home page (/ → homeFor(role)) returns 200
//   - the Jaipur store keeper sees no NCR row in v_stock_position or job_cards
//   - anon reads no row from any public table or view
// Each demo session is signed out with scope 'local', so no reviewer's session is touched.
// If signUp or anonymous sign-in unexpectedly succeeds, a junk auth user now exists: the output
// names it so it can be deleted in the dashboard (Authentication → Users).
//
// Run: PROD_URL=https://vutto-parts-blush.vercel.app pnpm tsx --env-file=.env.prod.local scripts/smoke-prod.ts
// Env: PROD_URL, SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable), DEMO_PASSWORD.
// Never imported from src/.
import { readdirSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { homeFor } from "../src/lib/permissions";
import { DEMO_USERS, WORKSHOP_IDS, type DemoUser } from "../tests/db/demo-users";
import { env, exitWithError, scriptClientOptions } from "./create-demo-users";

type Relation = keyof Database["public"]["Tables"] | keyof Database["public"]["Views"];

// Every public table and view. Typed as a full Record, so typecheck fails when one is added
// to the schema and not listed here.
const RELATIONS: Record<Relation, true> = {
  activity_log: true,
  app_errors: true,
  bikes: true,
  bins: true,
  demo_meta: true,
  doc_counters: true,
  emergency_buys: true,
  finding_type_parts: true,
  finding_types: true,
  grn_lines: true,
  grns: true,
  idempotency: true,
  inspection_findings: true,
  job_card_lines: true,
  job_cards: true,
  model_variants: true,
  part_fitments: true,
  parts: true,
  po_lines: true,
  profiles: true,
  purchase_orders: true,
  reorder_settings: true,
  stock_balances: true,
  stock_moves: true,
  supplier_parts: true,
  suppliers: true,
  vehicle_models: true,
  workshops: true,
  v_bike_list: true,
  v_blocked_bikes: true,
  v_count_bins: true,
  v_emergency_buys: true,
  v_emergency_buys_list: true,
  v_excess_on_order: true,
  v_grn_list: true,
  v_inbound_shortfalls: true,
  v_job_card_findings: true,
  v_line_eta: true,
  v_missing_parts: true,
  v_part_last_price: true,
  v_po_list: true,
  v_quarantine_stock: true,
  v_receiving_stock: true,
  v_stock_position: true,
  v_store_cards: true,
  v_store_waiting_lines: true,
};

type Result = { ok: boolean; name: string; detail: string };
const results: Result[] = [];

function record(ok: boolean, name: string, detail: string): void {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` – ${detail}` : ""}`);
}

/** Runs one check; an unexpected throw is a failure of that check, not of the whole run. */
async function check(name: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<void> {
  try {
    const { ok, detail } = await fn();
    record(ok, name, detail);
  } catch (e) {
    record(false, name, e instanceof Error ? e.message : String(e));
  }
}

function newestLocalMigration(): string {
  const versions = readdirSync("supabase/migrations")
    .map((file) => /^(\d{14})_.*\.sql$/.exec(file)?.[1])
    .filter((v): v is string => v !== undefined)
    .sort();
  const newest = versions.at(-1);
  if (!newest) throw new Error("No migrations found in supabase/migrations");
  return newest;
}

/** A Supabase client that keeps its auth cookies in memory, so the app accepts them as a browser session. */
function cookieClient(url: string, key: string) {
  const jar = new Map<string, string>();
  // Untyped: the checks below loop over a table and a view, which the typed builder cannot take as a union.
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  return { client, cookieHeader };
}

async function get(prodUrl: string, path: string, cookie?: string): Promise<Response> {
  return fetch(new URL(path, prodUrl), {
    redirect: "manual",
    cache: "no-store",
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(20_000),
  });
}

/**
 * Where a response redirects to, or null. Pages under (app) stream (loading.tsx), so a redirect()
 * after the first byte arrives as a 200 whose HTML carries <meta id="__next-page-redirect"
 * http-equiv="refresh" content="1;url=/store">, not as a 3xx with Location.
 */
async function redirectTarget(prodUrl: string, res: Response): Promise<string | null> {
  const location = res.headers.get("location");
  if (location) return new URL(location, prodUrl).pathname;
  const meta = /<meta id="__next-page-redirect"[^>]*content="\d+;url=([^"]+)"/.exec(await res.text());
  return meta ? new URL(meta[1].replaceAll("&amp;", "&"), prodUrl).pathname : null;
}

async function demoUserChecks(prodUrl: string, url: string, key: string, password: string, user: DemoUser): Promise<void> {
  const { client, cookieHeader } = cookieClient(url, key);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password });
  record(!error, `login ${user.email}`, error ? `${error.message} (${error.status ?? "?"})` : "");
  if (error) return;

  try {
    const home = homeFor(user.role);
    await check(`home ${user.email} → ${home}`, async () => {
      const root = await get(prodUrl, "/", cookieHeader());
      const target = await redirectTarget(prodUrl, root);
      if (target !== home) return { ok: false, detail: `/ answered ${root.status} → ${target ?? "no redirect"}` };
      const page = await get(prodUrl, home, cookieHeader());
      const to = await redirectTarget(prodUrl, page);
      return { ok: page.status === 200 && to === null, detail: `${page.status}${to ? ` → ${to}` : ""}` };
    });

    if (user.key === "jpr_store") await jaipurIsolation(client);
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}

/** The Jaipur store keeper must see Jaipur rows only (the own-workshop count shows the query works). */
async function jaipurIsolation(client: ReturnType<typeof cookieClient>["client"]): Promise<void> {
  for (const relation of ["v_stock_position", "job_cards"] as const) {
    await check(`jpr.store sees no NCR row in ${relation}`, async () => {
      const count = async (workshopId: string) => {
        const { count, error } = await client
          .from(relation)
          .select("*", { count: "exact", head: true })
          .eq("workshop_id", workshopId);
        if (error) throw new Error(`${error.code}: ${error.message}`);
        return count ?? 0;
      };
      const [ncr, jpr] = await Promise.all([count(WORKSHOP_IDS.NCR), count(WORKSHOP_IDS.JPR)]);
      const notJpr = await client
        .from(relation)
        .select("*", { count: "exact", head: true })
        .neq("workshop_id", WORKSHOP_IDS.JPR);
      if (notJpr.error) throw new Error(`${notJpr.error.code}: ${notJpr.error.message}`);
      const other = notJpr.count ?? 0;
      return {
        ok: ncr === 0 && other === 0 && jpr > 0,
        detail: `NCR rows ${ncr}, non-JPR rows ${other}, own JPR rows ${jpr}${jpr === 0 ? " (expected > 0: is the demo seed loaded?)" : ""}`,
      };
    });
  }
}

async function main(): Promise<void> {
  const prodUrl = env("PROD_URL");
  const url = env("SUPABASE_URL");
  const key = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = env("DEMO_PASSWORD");
  if (key.startsWith("sb_secret_")) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY holds a secret key; use the publishable key");
  console.log(`Smoke test: app ${new URL(prodUrl).host}, Supabase ${new URL(url).hostname}\n`);

  const expected = newestLocalMigration();
  await check(`/api/health ok with schema_version ${expected}`, async () => {
    const res = await get(prodUrl, "/api/health");
    const body = (await res.json()) as { ok?: boolean; schema_version?: string; commit?: string };
    return {
      ok: res.status === 200 && body.ok === true && body.schema_version === expected,
      detail: `${res.status}, schema_version ${body.schema_version ?? "none"}, commit ${body.commit ?? "?"}`,
    };
  });

  await check("/login returns 200", async () => {
    const res = await get(prodUrl, "/login");
    return { ok: res.status === 200, detail: String(res.status) };
  });

  const anon = createClient(url, key, scriptClientOptions);

  await check("signUp is refused", async () => {
    const email = `smoke-${Date.now()}@invalid.example.com`;
    const { data, error } = await anon.auth.signUp({ email, password: `Smoke-${crypto.randomUUID()}` });
    if (error) return { ok: true, detail: `${error.code ?? error.status}: ${error.message}` };
    return { ok: false, detail: `signups are ON: created ${email} (id ${data.user?.id ?? "?"}); delete it in the dashboard` };
  });

  await check("anonymous sign-in is refused", async () => {
    const { data, error } = await anon.auth.signInAnonymously();
    if (error) return { ok: true, detail: `${error.code ?? error.status}: ${error.message}` };
    await anon.auth.signOut({ scope: "local" });
    return { ok: false, detail: `anonymous sign-in is ON: created user ${data.user?.id ?? "?"}; delete it in the dashboard` };
  });

  for (const user of DEMO_USERS) await demoUserChecks(prodUrl, url, key, password, user);

  // A fresh client with no session, so every request is made as the anon role.
  const anonReader = createClient(url, key, scriptClientOptions);
  const readable: string[] = [];
  let denied = 0;
  for (const relation of Object.keys(RELATIONS)) {
    const { data, error } = await anonReader.from(relation).select("*").limit(1);
    if (error) denied += 1;
    else if (data.length > 0) readable.push(relation);
  }
  const total = Object.keys(RELATIONS).length;
  record(
    readable.length === 0,
    `anon reads no row from ${total} tables and views`,
    readable.length === 0 ? `${denied} denied, ${total - denied} empty` : `rows readable from: ${readable.join(", ")}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch(exitWithError);
