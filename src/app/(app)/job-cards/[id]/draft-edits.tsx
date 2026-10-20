"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FindingsChecklist, findingsInput, type FindingTypeOption, type PickedFindings } from "@/components/findings-checklist";
import { Field, NativeSelect } from "@/components/forms/field";
import { RpcDialog } from "@/components/rpc-dialog";
import { useT } from "@/lib/i18n/client";
import { setBikeVariant, updateDraftFindings } from "./actions";
import type { CardView, FindingView } from "./types";

type CardResult = { lines?: unknown[]; unresolved_findings?: unknown[] } | null;

/** Draft cards only (SPEC §5.2): fix the inspection findings; suggested lines are regenerated. */
export function EditFindings({
  card,
  findings,
  findingTypes,
  userId,
}: {
  card: CardView;
  findings: FindingView[];
  findingTypes: FindingTypeOption[];
  userId: string;
}) {
  const t = useT();
  const initial = (): PickedFindings =>
    Object.fromEntries(
      findings.map((f) => [f.finding_type_id, { qty: f.qty === null ? "" : String(f.qty), notes: f.notes ?? "" }]),
    );
  const [picked, setPicked] = useState<PickedFindings>(initial);
  return (
    <RpcDialog
      userId={userId}
      action={updateDraftFindings}
      values={() => ({ card_id: card.id, findings: findingsInput(picked) })}
      triggerLabel={t("jobCard.editFindings")}
      triggerTestId="edit-findings"
      title={t("jobCard.editFindingsTitle", { reg: card.reg_no })}
      description={t("jobCard.editFindingsBody")}
      confirmLabel={t("jobCard.saveFindings")}
      onOpenChange={(open) => open && setPicked(initial())}
      onSuccess={(data) => {
        const r = data as CardResult;
        toast.success(
          t("jobCard.suggestionsUpdated", { lines: r?.lines?.length ?? 0, unresolved: r?.unresolved_findings?.length ?? 0 }),
        );
      }}
    >
      <FindingsChecklist findingTypes={findingTypes} picked={picked} onChange={setPicked} />
    </RpcDialog>
  );
}

export type VariantOption = { id: string; name: string; year_from: number; year_to: number | null };

/** Unknown variant on a draft card: set it; suggestions are regenerated for the bike's attributes. */
export function SetVariant({ card, variants, userId }: { card: CardView; variants: VariantOption[]; userId: string }) {
  const t = useT();
  const [variantId, setVariantId] = useState("");
  // Only variants sold in the bike's year (the bike trigger refuses others: MFG_YEAR_OUT_OF_RANGE).
  const options = variants.filter((v) => v.year_from <= card.mfg_year && card.mfg_year <= (v.year_to ?? card.mfg_year));
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-50 p-3 text-sky-950 dark:bg-sky-950 dark:text-sky-50"
    >
      <p className="min-w-0 break-words">{t("jobCard.unknownVariantBanner")}</p>
      <RpcDialog
        userId={userId}
        action={setBikeVariant}
        values={() => (variantId ? { bike_id: card.bike_id, variant_id: variantId } : null)}
        triggerLabel={t("jobCard.setVariant")}
        triggerVariant="default"
        triggerTestId="set-variant"
        title={t("jobCard.setVariantTitle", { reg: card.reg_no })}
        description={t("jobCard.setVariantBody", { year: card.mfg_year })}
        confirmLabel={t("jobCard.setVariant")}
        onOpenChange={(open) => !open && setVariantId("")}
        onSuccess={(data) => {
          const r = data as CardResult;
          toast.success(
            t("jobCard.suggestionsUpdated", { lines: r?.lines?.length ?? 0, unresolved: r?.unresolved_findings?.length ?? 0 }),
          );
        }}
      >
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("jobCard.noVariantForYear", { year: card.mfg_year })}</p>
        ) : (
          <Field label={t("bikes.variant")}>
            {(id) => (
              <NativeSelect id={id} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                <option value="">{t("jobCard.chooseVariant")}</option>
                {options.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.year_from}–{v.year_to ?? ""})
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
      </RpcDialog>
    </div>
  );
}
