// Public liveness check (the proxy skips this path). Reports public.health(): {ok, schema_version}
// with the latest applied migration (SPEC §16). Anon client without cookies: no user data.
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/env.client";
import type { Database } from "@/lib/database.types";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const supabase = createClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  const { data, error } = await supabase.rpc("health");
  if (error) {
    return Response.json({ ok: false }, { status: 503, headers: noStore });
  }
  return Response.json(data, { headers: noStore });
}
