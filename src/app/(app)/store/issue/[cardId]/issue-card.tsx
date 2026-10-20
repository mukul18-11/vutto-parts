"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BinPicker, type BinOption } from "@/components/bin-picker";
import { ErrorDetail } from "@/components/error-detail";
import { FitBadge, type FitBadgeRow } from "@/components/fit-badge";
import { PartPicker, type PartHit } from "@/components/part-picker";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcDialog } from "@/components/rpc-dialog";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { issueMax, needsSecondTap } from "@/lib/store";
import { useRpcForm, type RpcFormState } from "@/lib/use-rpc-form";
import { cn } from "@/lib/utils";
import { addExtraPart, issueToJobCard, type IssueResult } from "../../actions";

type Enums = Database["public"]["Enums"];

export type IssueBin = { id: string; code: string; kind: Enums["bin_kind"]; on_hand: number };
export type IssueLineView = {
  id: string;
  part_id: string;
  sku: string;
  name: string;
  name_hi: string | null;
  uom: Enums["uom"];
  is_universal: boolean;
  qty_required: number;
  qty_reserved: number;
  net_issued: number;
  uncovered: number;
  status: Enums["line_status"];
  fit: FitBadgeRow | null;
  /** Normal and receiving bins holding the part, receiving first. */
  bins: IssueBin[];
};

type Props = {
  userId: string;
  workshopId: string;
  workshopCode: string;
  card: { id: string; code: string; confirmed: boolean; variantId: string | null };
  bikeLabel: string;
  issuable: boolean;
  lines: IssueLineView[];
  /** Every active normal and receiving bin, for the typed bin code. */
  bins: BinOption[];
  /** Templates with {move} and {line}, built on the server (keeps ?ws= for admin). */
  links: { done: string; emergency: string };
};

/** The card's lines; tap a reserved line to issue it (one form open at a time). */
export function IssueCard({ userId, workshopId, workshopCode, card, bikeLabel, issuable, lines, bins, links }: Props) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section aria-labelledby="issue-lines" className="flex flex-col gap-3">
      <h2 id="issue-lines" className="text-lg font-semibold">
        {t("issue.lines")}
      </h2>
      {lines.length === 0 && <p className="text-sm text-muted-foreground">{t("issue.noLines")}</p>}
      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const open = openId === line.id;
          const uom = t(`enums.uom.${line.uom}`);
          return (
            <li
              key={line.id}
              className={cn("rounded-xl border", open && "border-primary")}
              data-testid={`issue-line-${line.sku}`}
              data-status={line.status}
            >
              <div className="flex flex-col gap-1 p-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{line.sku}</span>
                  <StatusBadge enum="line_status" value={line.status} />
                  {line.qty_reserved > 0 && <FitBadge fit={line.fit} isUniversal={line.is_universal} bikeLabel={bikeLabel} />}
                </span>
                <span className="break-words">{line.name}</span>
                {line.name_hi && <span className="text-sm text-muted-foreground">{line.name_hi}</span>}
                <span className="flex flex-wrap gap-x-3 text-sm tabular-nums">
                  <span className="font-semibold" data-testid="line-reserved">
                    {t("issue.reserved", { qty: line.qty_reserved, uom })}
                  </span>
                  <span data-testid="line-issued">{t("issue.issued", { qty: line.net_issued, uom })}</span>
                  {line.uncovered > 0 && (
                    <span className="text-amber-700 dark:text-amber-300">{t("issue.stillNeeded", { qty: line.uncovered, uom })}</span>
                  )}
                </span>
                {line.qty_reserved > 0 && (
                  <BinsHeld line={line} />
                )}
                <div className="mt-1 flex flex-wrap gap-2">
                  {issuable && line.qty_reserved > 0 && (
                    <Button
                      type="button"
                      variant={open ? "outline" : "default"}
                      className="h-12 min-w-28 text-base"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : line.id)}
                      data-testid={`issue-open-${line.sku}`}
                    >
                      {open ? t("issue.close") : t("issue.open")}
                    </Button>
                  )}
                  {line.uncovered > 0 && (
                    <Button asChild variant="outline" className="h-12 text-base">
                      <Link href={links.emergency.replace("{line}", line.id)} data-testid={`emergency-${line.sku}`}>
                        {t("issue.emergencyBuy")}
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
              {open && (
                <IssueForm
                  userId={userId}
                  workshopCode={workshopCode}
                  line={line}
                  bins={bins}
                  bikeLabel={bikeLabel}
                  doneHref={links.done}
                />
              )}
            </li>
          );
        })}
      </ul>
      {card.confirmed && <AddExtraPart userId={userId} workshopId={workshopId} card={card} />}
    </section>
  );
}

/** "Where it is": receiving bins first ("Not yet put away"), then normal bins. */
function BinsHeld({ line }: { line: IssueLineView }) {
  const t = useT();
  const uom = t(`enums.uom.${line.uom}`);
  if (line.bins.length === 0) return <span className="text-sm text-destructive">{t("issue.noStock")}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted-foreground">{t("issue.whereItIs")}:</span>
      {line.bins.map((b) => (
        <span key={b.id} className="font-mono" data-testid={`held-${b.code}`}>
          {`${b.code} ${b.on_hand} ${uom}`}
          {b.kind === "receiving" && <span className="ml-1 font-sans text-amber-700 dark:text-amber-300">({t("issue.notPutAway")})</span>}
        </span>
      ))}
    </span>
  );
}

function IssueForm({
  userId,
  workshopCode,
  line,
  bins,
  bikeLabel,
  doneHref,
}: {
  userId: string;
  workshopCode: string;
  line: IssueLineView;
  bins: BinOption[];
  bikeLabel: string;
  doneHref: string;
}) {
  const t = useT();
  const router = useRouter();
  const [binId, setBinId] = useState<string | null>(null);
  const [pickKey, setPickKey] = useState(0);
  const [qty, setQty] = useState(1);
  // Amber and red badges need a second tap; the confirmation holds for the line, not the bin.
  const [fitConfirmed, setFitConfirmed] = useState(false);
  const form = useRpcForm(issueToJobCard, {
    userId,
    onSuccess: (data: IssueResult) => router.replace(doneHref.replace("{move}", String(data.move_id))),
  });

  const bin = bins.find((b) => b.id === binId) ?? null;
  const held = line.bins.find((b) => b.id === binId);
  const max = binId ? issueMax(line.qty_reserved, held?.on_hand ?? 0) : issueMax(line.qty_reserved, null);
  const effectiveQty = Math.max(1, Math.min(qty, max));
  const gate = needsSecondTap(line.fit?.badge as "green" | "amber" | "red" | undefined) && !fitConfirmed;
  const uom = t(`enums.uom.${line.uom}`);

  const choose = (id: string) => {
    setBinId(id);
    setPickKey((k) => k + 1);
    form.reset();
  };
  const run = () => {
    if (!binId || max < 1) return;
    if (gate) {
      setFitConfirmed(true);
      return;
    }
    form.submit({ line_id: line.id, bin_id: binId, qty: effectiveQty });
  };

  return (
    <div className="flex flex-col gap-3 border-t p-3" data-testid="issue-form">
      {line.bins.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("issue.whereItIs")}>
          {line.bins.map((b) => (
            <Button
              key={b.id}
              type="button"
              variant={b.id === binId ? "default" : "secondary"}
              className="h-12 font-mono text-base"
              onClick={() => choose(b.id)}
              data-testid={`suggested-bin-${b.code}`}
            >
              {`${b.code} · ${b.on_hand}`}
              {b.kind === "receiving" && <span className="font-sans text-xs">{t("issue.notPutAway")}</span>}
            </Button>
          ))}
        </div>
      )}
      <BinPicker
        key={pickKey}
        bins={bins}
        workshopCode={workshopCode}
        value={binId}
        onChange={(id) => {
          setBinId(id);
          form.reset();
        }}
        testId="issue-bin"
      />
      {binId && held === undefined && (
        <p role="alert" className="text-sm text-destructive">
          {t("issue.noStock")}
        </p>
      )}
      <QtyStepper
        label={t("issue.qty")}
        value={effectiveQty}
        min={1}
        max={Math.max(1, max)}
        onChange={setQty}
        uom={line.uom}
        disabled={max < 1}
        testId="issue-qty"
      />
      {fitConfirmed && line.fit?.badge === "amber" && (
        <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          {t("issue.amberWarning", { bike: bikeLabel })}
        </p>
      )}
      {fitConfirmed && line.fit?.badge === "red" && (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-950 dark:bg-red-950 dark:text-red-50">
          {t("issue.redWarning", { note: line.fit.last_flag_note ?? "–" })}
        </p>
      )}
      <RpcFormStatus state={form.state} onRetry={run} />
      <IssueError state={form.state} onPickBin={choose} uom={uom} />
      <div className="sticky bottom-0 -mx-3 bg-background px-3 py-2">
        <Button
          type="button"
          className={cn("h-14 w-full text-base", fitConfirmed && line.fit?.badge === "red" && "bg-red-700 hover:bg-red-800")}
          disabled={form.disabled || !binId || max < 1}
          onClick={run}
          data-testid="issue-submit"
        >
          {form.pending
            ? t("rpcForm.saving")
            : !binId
              ? t("issue.pickBin")
              : needsSecondTap(line.fit?.badge as "amber" | "red" | undefined) && fitConfirmed
                ? t("issue.issueAnyway", { code: bin?.code ?? "" })
                : t("issue.submit", { qty: effectiveQty, uom, code: bin?.code ?? "" })}
        </Button>
      </div>
    </div>
  );
}

type BinDetail = { code?: string; on_hand?: number; bins?: { bin_id: string; code: string; kind: string; on_hand: number }[] };
type ReservationDetail = { reserved?: number; available?: number; held_by?: string[] };

/**
 * SPEC §8.1 failures with a next step: INSUFFICIENT_BIN_STOCK lists the other bins holding the
 * part (tap one); INSUFFICIENT_RESERVATION says which cards hold it ("Ask manager to reallocate").
 */
function IssueError({ state, onPickBin, uom }: { state: RpcFormState<IssueResult>; onPickBin: (id: string) => void; uom: string }) {
  const t = useT();
  if (state.kind !== "error") return null;
  if (state.code === "INSUFFICIENT_BIN_STOCK") {
    const d = (state.detail ?? {}) as BinDetail;
    const others = d.bins ?? [];
    return (
      <div className="flex flex-col gap-2" data-testid="other-bins">
        <p className="text-sm">{t("issue.otherBins", { code: d.code ?? "", on_hand: d.on_hand ?? 0 })}</p>
        <div className="flex flex-wrap gap-2">
          {others.map((b) => (
            <Button key={b.bin_id} type="button" variant="secondary" className="h-12 font-mono text-base" onClick={() => onPickBin(b.bin_id)}>
              {t("issue.binOption", { code: b.code, qty: `${b.on_hand} ${uom}` })}
            </Button>
          ))}
        </div>
      </div>
    );
  }
  if (state.code === "INSUFFICIENT_RESERVATION") {
    const d = (state.detail ?? {}) as ReservationDetail;
    return (
      <div className="flex flex-col gap-1 text-sm" data-testid="held-by">
        <p>{t("issue.reservationNow", { reserved: d.reserved ?? 0, available: d.available ?? 0 })}</p>
        {(d.held_by ?? []).length > 0 && <p className="font-mono">{t("issue.heldBy", { list: (d.held_by ?? []).join(", ") })}</p>}
        <p className="font-medium">{t("issue.askManager")}</p>
      </div>
    );
  }
  return <ErrorDetail state={state} />;
}

/** A mechanic asks for a part not on the card: the store keeper adds it with a reason (SPEC §2). */
function AddExtraPart({
  userId,
  workshopId,
  card,
}: {
  userId: string;
  workshopId: string;
  card: { id: string; code: string; variantId: string | null };
}) {
  const t = useT();
  const [part, setPart] = useState<PartHit | null>(null);
  const [qty, setQty] = useState(1);
  return (
    <RpcDialog
      userId={userId}
      action={addExtraPart}
      values={(reason) => (part ? { card_id: card.id, part_id: part.part_id, qty, reason } : null)}
      triggerLabel={t("issue.addExtra")}
      triggerVariant="outline"
      triggerClassName="h-12 w-full text-base sm:w-auto"
      triggerTestId="add-extra"
      title={t("issue.addExtraTitle", { code: card.code })}
      confirmLabel={t("issue.addExtraConfirm")}
      reason="required"
      reasonLabel={t("issue.extraReason")}
      onOpenChange={(o) => {
        if (!o) {
          setPart(null);
          setQty(1);
        }
      }}
    >
      <PartPicker workshopId={workshopId} variantId={card.variantId} selectedId={part?.part_id} onPick={setPart} />
      {part && <QtyStepper label={t("issue.extraQty")} value={qty} onChange={setQty} min={1} max={999} uom={part.uom} />}
    </RpcDialog>
  );
}
