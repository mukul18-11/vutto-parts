// Shared by the server action pattern (src/lib/rpc.ts) and the client hook (use-rpc-form.ts).
// Pure, so the client-side decisions are unit tested.
import type { ResultCode } from "@/lib/errors";
import type { MessageKey } from "@/lib/i18n";

export type RpcOk<T> = { ok: true; data: T };
export type RpcFail = {
  ok: false;
  code: ResultCode;
  message: string;
  detail?: unknown;
  fieldErrors?: Record<string, MessageKey>;
  /** app_errors id for UNKNOWN failures ("Something went wrong (ref …)"). */
  ref?: string;
};
export type RpcResult<T> = RpcOk<T> | RpcFail;

/** What every form sends besides its own fields (SPEC §11.1, §12). */
export type RpcEnvelope = { request_id: string; rendered_user_id: string };

export type FormStep = {
  /** Replace the request_id: only after a confirmed outcome. */
  renewRequestId: boolean;
  /** router.refresh() so the screen shows current stock. */
  refresh: boolean;
  /** Send the user to /login?next=… */
  redirectToLogin: boolean;
  /** Show "Your earlier submit was saved" instead of an error. */
  earlierSaved: boolean;
};

const REFRESH_CODES: ReadonlySet<ResultCode> = new Set([
  "INSUFFICIENT_RESERVATION",
  "INSUFFICIENT_BIN_STOCK",
  "STALE_COUNT",
]);

export function nextStep(result: RpcResult<unknown>): FormStep {
  const step: FormStep = { renewRequestId: false, refresh: false, redirectToLogin: false, earlierSaved: false };
  if (result.ok) return { ...step, renewRequestId: true };
  if (result.code === "SESSION_EXPIRED") return { ...step, redirectToLogin: true };
  if (REFRESH_CODES.has(result.code)) return { ...step, refresh: true };
  // The user edited the form after an unknown outcome and the first submit had gone through.
  if (result.code === "IDEMPOTENCY_KEY_REUSED") {
    return { ...step, renewRequestId: true, refresh: true, earlierSaved: true };
  }
  return step;
}

/** A deploy replaced the server action ids; only a reload helps. */
export function isServerActionMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes("Failed to find Server Action");
}

/** Login URL that brings the user back to the current page. */
export function loginUrl(currentPath: string): string {
  return `/login?next=${encodeURIComponent(currentPath)}`;
}
