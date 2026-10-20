"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, inputClass } from "@/components/forms/field";
import { PartPicker, type PartHit } from "@/components/part-picker";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcButton, RpcDialog } from "@/components/rpc-dialog";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canPlainClose, closeEffects } from "@/lib/close-effects";
import { useT } from "@/lib/i18n/client";
import { formatDateOnly } from "@/lib/time";
import { useRpcForm, type RpcFormState } from "@/lib/use-rpc-form";
import {
  addLine,
  cancelBike,
  cancelCard,
  clearNeedsReview,
  closeCard,
  confirmCard,
  createCard,
  markArrived,
  setNeededBy,
  startRepair,
} from "./actions";
import type { CardView, FindingView, LineView } from "./types";

const ACTIVE_BIKE = new Set(["purchased", "at_workshop", "in_repair"]);

/** needed_by: editable on draft and confirmed cards (SPEC §5.2 set_needed_by). */
export function NeededBy({ card, userId }: { card: CardView; userId: string }) {
  const t = useT();
  const [date, setDate] = useState(card.needed_by ?? "");
  const { submit, pending, disabled, state } = useRpcForm(setNeededBy, { userId });
  const editable = card.status === "draft" || card.status === "confirmed";
  if (!editable) {
    return (
      <p className="text-sm">
        {t("jobCard.neededBy")}: {card.needed_by ? formatDateOnly(card.needed_by) : "–"}
      </p>
    );
  }
  const run = () => submit({ card_id: card.id, date });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("jobCard.neededBy")} hint={card.needed_by ? undefined : t("jobCard.neededByDefault")}>
          {(id) => (
            <Input id={id} type="date" className={`${inputClass} w-44`} value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          disabled={disabled || !date || date === card.needed_by}
          onClick={run}
        >
          {pending ? t("rpcForm.saving") : t("jobCard.saveNeededBy")}
        </Button>
      </div>
      <RpcFormStatus state={state} onRetry={run} />
    </div>
  );
}

/** "Choose correct part" banner with the manager's Clear action (SPEC §8.2, clear_needs_review). */
export function NeedsReviewBanner({ card, userId }: { card: CardView; userId: string }) {
  const t = useT();
  return (
    <div
      role="status"
      data-testid="needs-review"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-100 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50"
    >
      <p className="min-w-0 break-words">
        <span className="font-semibold">{t("blocked.chooseCorrectPart")}</span> · {card.needs_review_reason}
      </p>
      <RpcDialog
        userId={userId}
        action={clearNeedsReview}
        values={(reason) => ({ card_id: card.id, reason })}
        triggerLabel={t("jobCard.clearReview")}
        title={t("jobCard.clearReviewTitle")}
        description={t("jobCard.clearReviewBody")}
        confirmLabel={t("jobCard.clearReview")}
        reason="required"
      />
    </div>
  );
}

type Props = {
  card: CardView;
  lines: LineView[];
  findings: FindingView[];
  userId: string;
  openCardHref: string | null;
  /** Job card link with {id} (keeps ?ws= for admin). */
  cardHref: string;
};

/** State-dependent actions for the card and its bike (SPEC §5.1, §5.2). */
export function CardActions({ card, lines, findings, userId, openCardHref, cardHref }: Props) {
  const t = useT();
  const router = useRouter();
  const open = card.status === "draft" || card.status === "confirmed";
  const bikeActive = ACTIVE_BIKE.has(card.bike_status);
  const labels = new Map(findings.map((f) => [f.id, f.label]));

  const confirmError = (state: RpcFormState<unknown>) => {
    if (state.kind !== "error" || state.code !== "UNRESOLVED_FINDINGS") return null;
    const list = ((state.detail as { findings?: { finding_id: string; label_en: string }[] } | null)?.findings ?? []).map(
      (f) => ({ id: f.finding_id, label: labels.get(f.finding_id) ?? f.label_en }),
    );
    return (
      <ul className="list-disc pl-5 text-sm" data-testid="unresolved-list">
        {list.map((f) => (
          <li key={f.id}>
            <a href={`#finding-${f.id}`} className="underline underline-offset-4">
              {f.label}
            </a>
          </li>
        ))}
      </ul>
    );
  };

  const cancelEffects = [t("jobCard.effectRelease"), t("jobCard.effectCancelLines"), t("jobCard.effectPosUnchanged")];

  return (
    <div className="flex flex-wrap items-start gap-2" data-testid="card-actions">
      {card.status === "draft" && (
        <RpcButton
          userId={userId}
          action={confirmCard}
          values={{ card_id: card.id }}
          label={t("jobCard.confirm")}
          testId="confirm-card"
          renderError={confirmError}
        />
      )}

      {card.status === "confirmed" && <AddLine card={card} userId={userId} />}

      {open && card.bike_status === "purchased" && (
        <RpcButton userId={userId} action={markArrived} values={{ bike_id: card.bike_id }} label={t("jobCard.markArrived")} variant="outline" />
      )}
      {card.status === "confirmed" && card.bike_status === "at_workshop" && (
        <RpcButton userId={userId} action={startRepair} values={{ bike_id: card.bike_id }} label={t("jobCard.startRepair")} variant="outline" />
      )}
      {card.status === "confirmed" && card.bike_status === "in_repair" && <Close card={card} lines={lines} userId={userId} />}

      {open && (
        <RpcDialog
          userId={userId}
          action={cancelCard}
          values={(reason) => ({ card_id: card.id, reason })}
          triggerLabel={t("jobCard.cancelCard")}
          triggerVariant="outline"
          title={t("jobCard.cancelCardTitle", { code: card.code })}
          confirmLabel={t("jobCard.cancelCard")}
          sheet
          effects={cancelEffects}
          reason="required"
          destructive
        />
      )}
      {bikeActive && (
        <RpcDialog
          userId={userId}
          action={cancelBike}
          values={(reason) => ({ bike_id: card.bike_id, reason })}
          triggerLabel={t("jobCard.cancelBike")}
          triggerVariant="outline"
          title={t("jobCard.cancelBikeTitle", { reg: card.reg_no })}
          confirmLabel={t("jobCard.cancelBike")}
          sheet
          effects={open ? [...cancelEffects, t("jobCard.effectBikeCancelled")] : [t("jobCard.effectBikeCancelled")]}
          reason="required"
          destructive
        />
      )}

      {card.status === "cancelled" && openCardHref && (
        <Button asChild className="h-11">
          <Link href={openCardHref}>{t("jobCard.openCurrent")}</Link>
        </Button>
      )}
      {card.status === "cancelled" && !openCardHref && bikeActive && (
        <RpcButton
          userId={userId}
          action={createCard}
          values={{ bike_id: card.bike_id }}
          label={t("jobCard.newCard")}
          onSuccess={(data) => {
            const id = (data as { card_id?: string } | null)?.card_id;
            if (id) router.push(cardHref.replace("{id}", id));
          }}
        />
      )}
    </div>
  );
}

/** Add a part to a confirmed card (manager: source manual, optional reason). */
function AddLine({ card, userId }: { card: CardView; userId: string }) {
  const t = useT();
  const [part, setPart] = useState<PartHit | null>(null);
  const [qty, setQty] = useState(1);
  return (
    <RpcDialog
      userId={userId}
      action={addLine}
      values={(reason) => (part ? { card_id: card.id, part_id: part.part_id, qty, reason: reason || null } : null)}
      triggerLabel={t("jobCard.addLine")}
      triggerVariant="outline"
      triggerTestId="add-line"
      title={t("jobCard.addLineTitle")}
      description={card.needs_review_reason ? t("jobCard.addLineClearsReview") : undefined}
      confirmLabel={t("jobCard.addLine")}
      reason="optional"
      onOpenChange={(o) => {
        if (!o) {
          setPart(null);
          setQty(1);
        }
      }}
    >
      <PartPicker
        workshopId={card.workshop_id}
        variantId={card.variant_id}
        selectedId={part?.part_id}
        onPick={setPart}
      />
      {part && (
        <QtyStepper label={t("jobCard.qty")} value={qty} onChange={setQty} min={1} max={999} uom={part.uom} />
      )}
    </RpcDialog>
  );
}

/** Close: plain when every line is fully issued; otherwise the drop-remaining sheet (SPEC §5.2). */
function Close({ card, lines, userId }: { card: CardView; lines: LineView[]; userId: string }) {
  const t = useT();
  const closeLines = lines.map((l) => ({ ...l }));
  if (canPlainClose(closeLines, card.needs_review_reason)) {
    return (
      <RpcButton
        userId={userId}
        action={closeCard}
        values={{ card_id: card.id, drop_remaining: false, reason: null }}
        label={t("jobCard.close")}
      />
    );
  }
  const effects = closeEffects(closeLines).map((e) => {
    if (e.cancels && e.release > 0) return t("jobCard.dropCancelRelease", { sku: e.sku, n: e.release });
    if (e.cancels) return t("jobCard.dropCancel", { sku: e.sku });
    if (e.release > 0)
      return t("jobCard.dropReleaseReduce", { sku: e.sku, n: e.release, from: e.from_required, to: e.to_required });
    return t("jobCard.dropReduce", { sku: e.sku, from: e.from_required, to: e.to_required });
  });
  if (card.needs_review_reason) effects.push(t("jobCard.dropClearsReview"));
  effects.push(t("jobCard.effectReady"));
  return (
    <RpcDialog
      userId={userId}
      action={closeCard}
      values={(reason) => ({ card_id: card.id, drop_remaining: true, reason })}
      triggerLabel={t("jobCard.close")}
      triggerVariant="default"
      triggerClassName="h-11"
      triggerTestId="close-card"
      title={t("jobCard.closeDropTitle", { code: card.code })}
      description={t("jobCard.closeDropBody")}
      confirmLabel={t("jobCard.closeDrop")}
      sheet
      effects={effects}
      reason="required"
    />
  );
}
