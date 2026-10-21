// Creates or repairs the five demo logins (SPEC §2, §12). Idempotent: reuses the routine the test
// globalSetup uses (tests/db/demo-users.ts): a user with the wrong id is recreated, a password is
// updated only when signing in with DEMO_PASSWORD fails (an admin password update logs out every
// session), and a profile is written only when it differs. Each check session is then signed out
// with scope 'local', so no other session of the shared account is touched.
//
// Local:      pnpm demo:users                      (reads .env)
// Production: pnpm exec tsx --env-file=.env.prod.local scripts/create-demo-users.ts --prod
// scripts/demo-guard.ts reuses repairDemoUsers on a schedule. Never imported from src/.
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { DEMO_USERS, ensureDemoUsers, type RepairLog } from "../tests/db/demo-users";

export function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export const scriptClientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/**
 * Checks every demo login and repairs only what is broken (see the header). Signs out each
 * check session with scope 'local'. Reports repairs through log; prints "ok" per user.
 */
export async function repairDemoUsers(opts: {
  url: string;
  publishableKey: string;
  secretKey: string;
  password: string;
  log: RepairLog;
}): Promise<void> {
  const admin = createClient<Database>(opts.url, opts.secretKey, scriptClientOptions);
  const sessions = await ensureDemoUsers(admin, { url: opts.url, publishableKey: opts.publishableKey }, opts.password, opts.log);

  for (const user of DEMO_USERS) {
    const client = createClient<Database>(opts.url, opts.publishableKey, scriptClientOptions);
    const { error } = await client.auth.setSession(sessions[user.key]);
    if (error) throw error;
    const { error: outError } = await client.auth.signOut({ scope: "local" });
    if (outError) throw outError;
    opts.log(`ok  ${user.email}`);
  }
}

/** Prints the message plus the HTTP status and code of Supabase errors; never the password or keys. */
export function exitWithError(e: unknown): never {
  if (e instanceof Error) {
    const { status, code } = e as { status?: number; code?: string };
    const extra = [status !== undefined && `status ${status}`, code && `code ${code}`].filter(Boolean).join(", ");
    console.error(extra ? `${e.message} (${extra})` : e.message);
  } else {
    console.error(e);
  }
  process.exit(1);
}

async function main(): Promise<void> {
  const prod = process.argv.includes("--prod");
  const url = env("SUPABASE_URL");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && !prod) {
    throw new Error(`Refusing to run against ${host} without --prod`);
  }

  console.log(`Demo users on ${host}`);
  await repairDemoUsers({
    url,
    publishableKey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    secretKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    password: env("DEMO_PASSWORD"),
    log: (message) => console.log(message),
  });
}

// Runs only as a script, not when demo-guard imports repairDemoUsers.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(exitWithError);
}
