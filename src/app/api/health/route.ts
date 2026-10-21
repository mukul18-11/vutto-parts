// Public liveness check (the proxy skips this path). Reports public.health(): {ok, schema_version}
// with the latest applied migration (SPEC §16), plus the deployed commit. Anon client without
// cookies: no user data. 503 with a clear body when the database is unreachable or paused.
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/env.client";
import type { Database } from "@/lib/database.types";
import { healthResponse } from "@/lib/health";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const supabase = createClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // A paused project can hang; give up well before the function timeout.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) }) },
  });
  let result: ReturnType<typeof healthResponse>;
  try {
    const { data, error } = await supabase.rpc("health");
    result = healthResponse({ data, error }, clientEnv.NEXT_PUBLIC_COMMIT_SHA);
  } catch {
    result = healthResponse("unreachable", clientEnv.NEXT_PUBLIC_COMMIT_SHA);
  }
  return Response.json(result.body, { status: result.status, headers: noStore });
}
