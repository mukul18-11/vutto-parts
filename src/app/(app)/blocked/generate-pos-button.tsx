"use client";

import { RpcFormStatus } from "@/components/rpc-form-status";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { useRpcForm } from "@/lib/use-rpc-form";
import { generatePos, type GenerateResult } from "./actions";

/** "Generate POs" shortcut: runs draft PO generation and shows what changed. */
export function GeneratePosButton({ userId, workshopId, compact }: { userId: string; workshopId: string; compact?: boolean }) {
  const t = useT();
  const { submit, pending, disabled, state } = useRpcForm(generatePos, { userId });
  const run = () => submit({ workshop_id: workshopId });
  const result = state.kind === "ok" ? (state.data as unknown as GenerateResult) : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Button
        type="button"
        variant={compact ? "outline" : "default"}
        className="h-11"
        disabled={disabled}
        onClick={run}
        data-testid="generate-pos"
      >
        {pending ? t("rpcForm.saving") : t("blocked.generatePos")}
      </Button>
      <RpcFormStatus state={state} onRetry={run} />
      {result && (
        <div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50">
          <p>{t("blocked.generateResult", { added: result.added, changed: result.changed, removed: result.removed })}</p>
          {result.unsourced.length > 0 && (
            <p className="mt-1">
              {t("blocked.needsSupplier")}: {result.unsourced.map((u) => u.sku).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
