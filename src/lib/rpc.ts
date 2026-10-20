import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { errorMessage, parseRpcError, type ErrorCode, type ParsedRpcError, type RpcErrorLike } from "@/lib/errors";
import { isMessageKey, type Lang, type MessageKey } from "@/lib/i18n";
import { getLang } from "@/lib/i18n/server";
import type { RpcFail, RpcResult } from "@/lib/rpc-form-logic";
import { createClient } from "@/lib/supabase/server";

export type { RpcResult, RpcEnvelope } from "@/lib/rpc-form-logic";

type Functions = Database["public"]["Functions"];
/** Public RPCs that follow SPEC §11.1 (they take p_request_id first). */
export type MutatingRpc = {
  [K in keyof Functions]: Functions[K]["Args"] extends { p_request_id: string } ? K : never;
}[keyof Functions];
type Client = Awaited<ReturnType<typeof createClient>>;

/** Every form schema extends this: the request_id and the user id the page was rendered for. */
export const rpcBase = z.object({ request_id: z.guid(), rendered_user_id: z.guid() });
export function rpcInput<S extends z.ZodRawShape>(shape: S) {
  return rpcBase.extend(shape);
}

const RETRY_DELAY_MS = 300;

type RunRpcOptions<S extends z.ZodType<z.infer<typeof rpcBase>>, F extends MutatingRpc> = {
  /** The page route, for app_errors. */
  route: string;
  schema: S;
  input: unknown;
  fn: F;
  /** RPC arguments without p_request_id (added from the parsed request_id). */
  toArgs: (data: z.output<S>) => Omit<Functions[F]["Args"], "p_request_id">;
};

/**
 * The server action pattern used by every form (SPEC §11, §14): Zod-parse, check the rendered
 * user, call exactly one RPC with the user's client (retrying lock timeouts and deadlocks once
 * with the same request_id), map errors to stable codes, and revalidate on success. Never throws
 * for expected failures; redirect()/notFound() pass through unstable_rethrow.
 */
export async function runRpc<S extends z.ZodType<z.infer<typeof rpcBase>>, F extends MutatingRpc>(
  opts: RunRpcOptions<S, F>,
): Promise<RpcResult<Functions[F]["Returns"]>> {
  return execute(opts.route, opts.schema, opts.input, true, (supabase, data) => {
    const args = { ...opts.toArgs(data), p_request_id: data.request_id } as Functions[F]["Args"];
    return callOnce(supabase, opts.fn, args);
  });
}

/** RPCs exempt from SPEC §11.1 steps 1–7 that a form calls (no p_request_id, no idempotency row). */
export type ExemptRpc = "reset_demo";

/**
 * The same pattern for an exempt RPC without arguments (public.reset_demo). The form's request_id
 * is used only as the error ref; the RPC's own try-lock and cooldown stop double submits, so a
 * lock timeout is not retried.
 */
export async function runExemptRpc<S extends z.ZodType<z.infer<typeof rpcBase>>, F extends ExemptRpc>(opts: {
  route: string;
  schema: S;
  input: unknown;
  fn: F;
}): Promise<RpcResult<Functions[F]["Returns"]>> {
  return execute(opts.route, opts.schema, opts.input, false, (supabase) => supabase.rpc(opts.fn));
}

async function execute<S extends z.ZodType<z.infer<typeof rpcBase>>, R>(
  route: string,
  schema: S,
  input: unknown,
  retryOnce: boolean,
  call: (supabase: Client, data: z.output<S>) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<RpcResult<R>> {
  const lang = await getLang();
  const fail = (code: ErrorCode, extra?: Partial<RpcFail>): RpcFail => ({
    ok: false,
    code,
    message: errorMessage(code, lang),
    ...extra,
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION", { fieldErrors: fieldErrorsFrom(parsed.error) });
  const data = parsed.data;

  let supabase: Client | null = null;
  try {
    supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return fail("SESSION_EXPIRED");
    if (auth.user.id !== data.rendered_user_id) return fail("SESSION_CHANGED");

    const client = supabase;
    let res = await call(client, data);
    let err = res.error ? parseRpcError(res.error as RpcErrorLike) : null;
    if (retryOnce && err?.retryable) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      res = await call(client, data);
      err = res.error ? parseRpcError(res.error as RpcErrorLike) : null;
    }

    if (!err) {
      revalidatePath("/", "layout");
      return { ok: true, data: res.data as R };
    }
    if (err.code !== "UNKNOWN") return fail(err.code, { detail: err.detail });
    return await unknownFailure(supabase, lang, route, data.request_id, err);
  } catch (e) {
    unstable_rethrow(e);
    const message = e instanceof Error ? e.message : String(e);
    return await unknownFailure(supabase, lang, route, data.request_id, {
      rawCode: "THROWN",
      rawMessage: message,
    });
  }
}

async function callOnce<F extends MutatingRpc>(supabase: Client, fn: F, args: Functions[F]["Args"]) {
  // The generic function name defeats supabase-js overload inference; args are typed by the caller.
  return supabase.rpc(fn, args as never);
}

/** Logs through log_app_error and returns "Something went wrong (ref <id>)". */
async function unknownFailure(
  supabase: Client | null,
  lang: Lang,
  route: string,
  requestId: string,
  err: Pick<ParsedRpcError, "rawCode" | "rawMessage">,
): Promise<RpcFail> {
  console.error("rpc unknown error", route, err.rawCode, err.rawMessage);
  let ref = requestId.slice(0, 8);
  try {
    if (supabase) {
      const { data } = await supabase.rpc("log_app_error", {
        p_route: route.slice(0, 200),
        p_code: (err.rawCode || "UNKNOWN").slice(0, 64),
        p_message: err.rawMessage || "unknown error",
        p_ref_request_id: requestId,
      });
      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id === "number" || typeof id === "string") ref = String(id);
    }
  } catch (e) {
    unstable_rethrow(e);
    console.error("log_app_error failed", e instanceof Error ? e.message : e);
  }
  return { ok: false, code: "UNKNOWN", message: errorMessage("UNKNOWN", lang, ref), ref };
}

/** Field errors keyed by field path; messages are i18n keys (schemas use keys as messages). */
export function fieldErrorsFrom(error: z.ZodError): Record<string, MessageKey> {
  const out: Record<string, MessageKey> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (key in out) continue;
    out[key] = isMessageKey(issue.message) ? issue.message : "validation.invalid";
  }
  return out;
}
