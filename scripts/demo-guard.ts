// The demo-guard GitHub Action (SPEC §16; .github/workflows/demo-guard.yml). Every run checks the
// five demo logins and repairs only the broken ones (repairDemoUsers: a password that still works
// is never updated, because an admin password update logs out every session of that account).
// With --reseed it also calls public.reseed_if_stale_service() through supabase-js with the secret
// key (service_role only), which re-applies the demo seed only when it is stale and idle (SPEC §15).
//
// Env: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable), SUPABASE_SERVICE_ROLE_KEY
// (secret), DEMO_PASSWORD. In Actions these come from repository secrets.
// Local check: pnpm exec tsx --env-file=.env scripts/demo-guard.ts --reseed
// Never imported from src/.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { env, exitWithError, repairDemoUsers, scriptClientOptions } from "./create-demo-users";

async function main(): Promise<void> {
  const reseed = process.argv.includes("--reseed");
  const url = env("SUPABASE_URL");
  const secretKey = env("SUPABASE_SERVICE_ROLE_KEY");
  console.log(`demo-guard on ${new URL(url).hostname}${reseed ? " (with reseed check)" : ""}`);

  await repairDemoUsers({
    url,
    publishableKey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    secretKey,
    password: env("DEMO_PASSWORD"),
    log: (message) => console.log(message),
  });

  if (reseed) {
    const admin = createClient<Database>(url, secretKey, scriptClientOptions);
    const { data, error } = await admin.rpc("reseed_if_stale_service");
    if (error) throw error;
    console.log(`reseed_if_stale_service: ${JSON.stringify(data)}`);
  }
}

main().catch(exitWithError);
