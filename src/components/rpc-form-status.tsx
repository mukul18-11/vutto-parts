"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import type { RpcFormState } from "@/lib/use-rpc-form";
import { OfflineBanner } from "./offline-banner";

/** The outcome line under every RPC form. Only a coded server error is shown as a failure. */
export function RpcFormStatus<T>({ state, onRetry }: { state: RpcFormState<T>; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <OfflineBanner />
      {state.kind === "error" && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {state.message}
        </p>
      )}
      {state.kind === "unknown" && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <p>{t("rpcForm.notConfirmedHint")}</p>
          {onRetry && (
            <Button type="button" className="h-12 w-full text-base" onClick={onRetry}>
              {t("rpcForm.notConfirmed")}
            </Button>
          )}
        </div>
      )}
      {state.kind === "app_updated" && (
        <Button type="button" variant="outline" className="h-12 w-full text-base" onClick={() => window.location.reload()}>
          {t("rpcForm.appUpdated")}
        </Button>
      )}
      {state.kind === "earlier_saved" && (
        <p role="status" className="rounded-lg bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          {t("rpcForm.earlierSaved")}
        </p>
      )}
    </div>
  );
}
