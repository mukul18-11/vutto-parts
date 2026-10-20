// Creates or repairs the five demo logins (SPEC §2, §12). Idempotent: reuses the routine the test
// globalSetup uses (tests/db/demo-users.ts): a user with the wrong id is recreated, a password is
// updated only when signing in with DEMO_PASSWORD fails (an admin password update logs out every
// session), and a profile is written only when it differs. Each check session is then signed out
// with scope 'local', so no other session of the shared account is touched.
//
// Local:      pnpm demo:users                      (reads .env)
// Production: pnpm exec tsx --env-file=.env.prod.local scripts/create-demo-users.ts --prod
// Never imported from src/.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { DEMO_USERS, ensureDemoUsers } from "../tests/db/demo-users";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

async function main(): Promise<void> {
  const prod = process.argv.includes("--prod");
  const url = env("SUPABASE_URL");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && !prod) {
    throw new Error(`Refusing to run against ${host} without --prod`);
  }

  const publishableKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient<Database>(url, env("SUPABASE_SERVICE_ROLE_KEY"), options);

  const sessions = await ensureDemoUsers(admin, { url, publishableKey }, env("DEMO_PASSWORD"));

  for (const user of DEMO_USERS) {
    const client = createClient<Database>(url, publishableKey, options);
    const { error } = await client.auth.setSession(sessions[user.key]);
    if (error) throw error;
    const { error: outError } = await client.auth.signOut({ scope: "local" });
    if (outError) throw outError;
    console.log(`ok  ${user.email}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
