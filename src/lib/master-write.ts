import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { errorMessage, parseRpcError, type ErrorCode } from "@/lib/errors";
import { getSessionContext } from "@/lib/auth";
import { getLang } from "@/lib/i18n/server";
import { fieldErrorsFrom, rpcBase } from "@/lib/rpc";
import type { RpcFail, RpcResult } from "@/lib/rpc-form-logic";
import { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

type Options<S extends z.ZodType<z.infer<typeof rpcBase>>> = {
  /** The page route, for app_errors. */
  route: string;
  schema: S;
  input: unknown;
  /** Exactly one insert or update on a master data table (SPEC §11.2), with the user's client. */
  write: (supabase: Client, data: z.output<S>) => PromiseLike<{ error: PostgrestError | null }>;
};

// SQLSTATEs of master data writes that are the user's to fix, not app errors.
const DUPLICATE = "23505";
const CHECK_OR_FK = new Set(["23514", "23503", "23502", "22P02", "22001"]);
const RLS = "42501";

/**
 * The server action for master data edits (CLAUDE.md rule 1 exception): the same envelope as
 * runRpc (Zod parse, rendered-user check, coded errors, revalidate), but one direct table write
 * under the admin-only RLS policies instead of an RPC. Only admin edits master data here. Trigger errors (VALIDATION with detail)
 * arrive as P0001 and keep their detail; constraint violations map to VALIDATION.
 */
export async function runTableWrite<S extends z.ZodType<z.infer<typeof rpcBase>>>(
  opts: Options<S>,
): Promise<RpcResult<null>> {
  const lang = await getLang();
  const fail = (code: ErrorCode, extra?: Partial<RpcFail>): RpcFail => ({
    ok: false,
    code,
    message: errorMessage(code, lang),
    ...extra,
  });

  const parsed = opts.schema.safeParse(opts.input);
  if (!parsed.success) return fail("VALIDATION", { fieldErrors: fieldErrorsFrom(parsed.error) });

  let supabase: Client | null = null;
  try {
    supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return fail("SESSION_EXPIRED");
    if (auth.user.id !== parsed.data.rendered_user_id) return fail("SESSION_CHANGED");
    // RLS would also refuse, but an UPDATE refused by RLS changes 0 rows without an error.
    const { profile } = await getSessionContext();
    if (!profile) return fail("NO_PROFILE");
    if (profile.role !== "admin") return fail("FORBIDDEN");

    const { error } = await opts.write(supabase, parsed.data);
    if (!error) {
      revalidatePath("/", "layout");
      return { ok: true, data: null };
    }
    if (error.code === DUPLICATE) return fail("VALIDATION", { detail: { reason: "duplicate" } });
    if (error.code && CHECK_OR_FK.has(error.code)) return fail("VALIDATION", { detail: { reason: "constraint" } });
    if (error.code === RLS) return fail("FORBIDDEN");
    const err = parseRpcError(error);
    if (err.code !== "UNKNOWN") return fail(err.code, { detail: err.detail });
    return await unknown(supabase, opts.route, parsed.data.request_id, err.rawCode, err.rawMessage);
  } catch (e) {
    unstable_rethrow(e);
    return await unknown(supabase, opts.route, parsed.data.request_id, "THROWN", e instanceof Error ? e.message : String(e));
  }

  async function unknown(client: Client | null, route: string, requestId: string, code: string, message: string) {
    console.error("table write unknown error", route, code, message);
    let ref = requestId.slice(0, 8);
    try {
      if (client) {
        const { data } = await client.rpc("log_app_error", {
          p_route: route.slice(0, 200),
          p_code: (code || "UNKNOWN").slice(0, 64),
          p_message: message || "unknown error",
          p_ref_request_id: requestId,
        });
        const id = (data as { id?: unknown } | null)?.id;
        if (typeof id === "number" || typeof id === "string") ref = String(id);
      }
    } catch (e) {
      unstable_rethrow(e);
    }
    return { ok: false as const, code: "UNKNOWN" as const, message: errorMessage("UNKNOWN", lang, ref), ref };
  }
}
