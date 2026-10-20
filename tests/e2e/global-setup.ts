// Playwright global setup (SPEC §17): local Supabase only. Ensures the five demo logins (plus the
// test user with no profile) and re-applies the demo seed, so every run starts from the same data.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import type { Database } from "../../src/lib/database.types";
import { DEMO_USERS, ensureAuthUser, ensureDemoUsers } from "../db/demo-users";
import { assertLocal, loadEnv, requireEnv } from "../db/env";
import { NO_PROFILE_USER } from "../db/sessions";

export default async function globalSetup() {
  loadEnv();
  assertLocal();

  const url = requireEnv("SUPABASE_URL");
  const publishableKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const password = requireEnv("DEMO_PASSWORD");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient<Database>(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), options);

  const sessions = await ensureDemoUsers(admin, { url, publishableKey }, password);
  const noProfile = await ensureAuthUser(admin, { url, publishableKey }, NO_PROFILE_USER, password);
  const { error } = await admin.from("profiles").delete().eq("user_id", NO_PROFILE_USER.id);
  if (error) throw error;

  // Close the check sessions (scope local), as scripts/create-demo-users.ts does.
  for (const session of [...DEMO_USERS.map((u) => sessions[u.key]), noProfile]) {
    const client = createClient<Database>(url, publishableKey, options);
    await client.auth.setSession(session);
    await client.auth.signOut({ scope: "local" });
  }

  const db = new pg.Client({ connectionString: requireEnv("DATABASE_URL") });
  await db.connect();
  try {
    await db.query("set statement_timeout = '30s'");
    await db.query("select private.apply_seed(private.ist_today())");
  } finally {
    await db.end();
  }
}
