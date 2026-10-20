"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ResultCode } from "@/lib/errors";
import type { MessageKey } from "@/lib/i18n";
import {
  isServerActionMissing,
  loginUrl,
  nextStep,
  type RpcEnvelope,
  type RpcResult,
} from "@/lib/rpc-form-logic";

export type RpcFormState<T> =
  | { kind: "idle" }
  | { kind: "ok"; data: T }
  | {
      kind: "error";
      code: ResultCode;
      message: string;
      detail?: unknown;
      fieldErrors?: Record<string, MessageKey>;
      ref?: string;
    }
  /** Network failure: the outcome is unknown. Keep the form and the request_id ("Not confirmed – Retry"). */
  | { kind: "unknown" }
  /** A deploy replaced the server actions ("App was updated – Reload"). */
  | { kind: "app_updated" }
  /** IDEMPOTENCY_KEY_REUSED: the earlier submit had gone through. */
  | { kind: "earlier_saved" };

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** navigator.onLine as state (true during server render). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** A form's own values: the action input without the envelope the hook adds. */
export type FormValues<P extends RpcEnvelope> = Omit<P, keyof RpcEnvelope>;

type Options<T> = {
  /** The user id the page was rendered for (SESSION_CHANGED check on the server). */
  userId: string;
  onSuccess?: (data: T) => void;
};

/**
 * Client side of the RPC pattern (SPEC §11.1, §14). The request_id is created once on mount,
 * reused for every retry and double tap, and replaced only after a confirmed outcome.
 */
export function useRpcForm<P extends RpcEnvelope, T>(
  action: (input: P) => Promise<RpcResult<T>>,
  { userId, onSuccess }: Options<T>,
) {
  const router = useRouter();
  const online = useOnline();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<RpcFormState<T>>({ kind: "idle" });
  const requestIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);

  // Created on mount, not during render, so server and client never disagree.
  useEffect(() => {
    requestIdRef.current ??= uuidv4();
  }, []);

  const submit = useCallback(
    (values: FormValues<P>) => {
      // Synchronous guard: a second tap before React re-renders does nothing.
      if (submittingRef.current || !navigator.onLine) return;
      submittingRef.current = true;
      requestIdRef.current ??= uuidv4();
      const input = { ...values, request_id: requestIdRef.current, rendered_user_id: userId } as P;

      startTransition(async () => {
        try {
          const result = await action(input);
          const step = nextStep(result);
          if (step.renewRequestId) requestIdRef.current = uuidv4();
          if (result.ok) {
            setState({ kind: "ok", data: result.data });
            onSuccess?.(result.data);
          } else if (step.earlierSaved) {
            setState({ kind: "earlier_saved" });
          } else {
            const { code, message, detail, fieldErrors, ref } = result;
            setState({ kind: "error", code, message, detail, fieldErrors, ref });
          }
          if (step.redirectToLogin) router.push(loginUrl(window.location.pathname + window.location.search));
          if (step.refresh) router.refresh();
        } catch (e) {
          setState(isServerActionMissing(e) ? { kind: "app_updated" } : { kind: "unknown" });
        } finally {
          submittingRef.current = false;
        }
      });
    },
    [action, onSuccess, router, userId],
  );

  const reset = useCallback(() => setState({ kind: "idle" }), []);

  return { submit, pending, disabled: pending || !online, online, state, reset };
}
