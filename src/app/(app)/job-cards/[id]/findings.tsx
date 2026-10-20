"use client";

import { useState } from "react";
import { PartPicker, type PartHit } from "@/components/part-picker";
import { RpcDialog } from "@/components/rpc-dialog";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { useRpcForm } from "@/lib/use-rpc-form";
import { resolveFinding } from "./actions";
import type { CardView, FindingView } from "./types";

/** Inspection findings with their resolution (SPEC §9.1); unresolved ones get a part picker on drafts. */
export function Findings({
  card,
  findings,
  userId,
  edit,
}: {
  card: CardView;
  findings: FindingView[];
  userId: string;
  /** The "Edit findings" action on draft cards. */
  edit?: React.ReactNode;
}) {
  const t = useT();
  const unresolved = findings.filter((f) => !f.line_id && !f.no_part_reason).length;
  return (
    <section aria-labelledby="findings" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="findings" className="text-lg font-semibold">
          {t("jobCard.findings")}{" "}
          {unresolved > 0 && (
            <Badge className="bg-red-100 align-middle text-red-900 dark:bg-red-950 dark:text-red-100">
              {t("jobCard.unresolvedCount", { n: unresolved })}
            </Badge>
          )}
        </h2>
        {edit}
      </div>
      {findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("jobCard.noFindings")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {findings.map((f) => (
            <li key={f.id} id={`finding-${f.id}`} className="scroll-mt-4 rounded-xl border p-3" data-testid={`finding-row-${f.code}`}>
              <FindingRow card={card} finding={f} userId={userId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FindingRow({ card, finding: f, userId }: { card: CardView; finding: FindingView; userId: string }) {
  const t = useT();
  const resolved = Boolean(f.line_id || f.no_part_reason);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-medium break-words">
          {f.label}
          {f.qty !== null && <span className="text-muted-foreground"> × {f.qty}</span>}
        </span>
        {f.line_id ? (
          <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            {t("jobCard.resolvedTo", { sku: f.line_sku ?? "" })}
          </Badge>
        ) : f.no_part_reason ? (
          <Badge variant="secondary">{t("jobCard.noPartNeeded")}</Badge>
        ) : (
          <Badge className="bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100">{t("jobCard.unresolved")}</Badge>
        )}
      </div>
      {f.notes && <p className="text-sm text-muted-foreground break-words">{f.notes}</p>}
      {f.no_part_reason && <p className="text-sm break-words">{t("jobCard.noPartReason", { reason: f.no_part_reason })}</p>}
      {!resolved && card.status === "draft" && <Resolve card={card} finding={f} userId={userId} />}
    </div>
  );
}

function Resolve({ card, finding: f, userId }: { card: CardView; finding: FindingView; userId: string }) {
  const t = useT();
  const [picked, setPicked] = useState<PartHit | null>(null);
  const { submit, pending, disabled, state } = useRpcForm(resolveFinding, { userId });
  const resolveWith = (partId: string) => submit({ finding_id: f.id, part_id: partId, no_part_reason: null });

  return (
    <div className="flex flex-col gap-3 border-t pt-2">
      {f.candidates.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{t("jobCard.candidates")}</p>
          <ul className="flex flex-col gap-1">
            {f.candidates.map((c) => {
              const red = c.flagged_count >= Math.max(1, c.confirmed_count);
              return (
                <li key={c.part_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
                  <span className="min-w-0 break-words">
                    <span className="font-mono text-sm">{c.sku}</span> {c.name}
                    {red && <span className="block text-xs text-destructive">{t("fit.flaggedWarning")}</span>}
                  </span>
                  <Button type="button" variant="outline" className="h-11" disabled={disabled} onClick={() => resolveWith(c.part_id)}>
                    {t("jobCard.usePart")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <PartPicker
        workshopId={card.workshop_id}
        variantId={card.variant_id}
        partType={f.part_type}
        selectedId={picked?.part_id}
        onPick={setPicked}
        testId={`picker-${f.code}`}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-11"
          disabled={disabled || !picked}
          onClick={() => picked && resolveWith(picked.part_id)}
          data-testid={`use-part-${f.code}`}
        >
          {pending ? t("rpcForm.saving") : picked ? t("jobCard.useSku", { sku: picked.sku }) : t("jobCard.pickPart")}
        </Button>
        <RpcDialog
          userId={userId}
          action={resolveFinding}
          values={(reason) => ({ finding_id: f.id, part_id: null, no_part_reason: reason })}
          triggerLabel={t("jobCard.noPartNeeded")}
          title={t("jobCard.noPartTitle", { finding: f.label })}
          confirmLabel={t("jobCard.noPartNeeded")}
          reason="required"
        />
      </div>
      <RpcFormStatus state={state} onRetry={() => picked && resolveWith(picked.part_id)} />
    </div>
  );
}
