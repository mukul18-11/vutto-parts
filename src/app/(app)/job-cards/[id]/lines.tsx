"use client";

import { useState } from "react";
import { EtaBadge } from "@/components/eta-badge";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcDialog } from "@/components/rpc-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { reallocate, setLineQty, switchLinePart } from "./actions";
import type { CardView, LineView } from "./types";

const GRID = "md:grid md:grid-cols-[minmax(0,2fr)_repeat(4,4.5rem)_minmax(0,1.3fr)_minmax(0,1fr)] md:items-start md:gap-3";

/** The card's lines as a table on desktop and stacked cards on a phone (SPEC §14). */
export function Lines({ card, lines, userId }: { card: CardView; lines: LineView[]; userId: string }) {
  const t = useT();
  return (
    <section aria-labelledby="lines" className="flex flex-col gap-2">
      <h2 id="lines" className="text-lg font-semibold">
        {t("jobCard.lines")}
      </h2>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {card.status === "draft" ? t("jobCard.noLinesDraft") : t("jobCard.noLines")}
        </p>
      ) : (
        <div className="flex flex-col rounded-xl border" role="table" aria-labelledby="lines">
          <div role="row" className={cn("hidden border-b px-3 py-2 text-xs font-medium text-muted-foreground", GRID)}>
            <span role="columnheader">{t("jobCard.part")}</span>
            <span role="columnheader">{t("jobCard.required")}</span>
            <span role="columnheader">{t("jobCard.reserved")}</span>
            <span role="columnheader">{t("jobCard.issued")}</span>
            <span role="columnheader">{t("jobCard.returned")}</span>
            <span role="columnheader">{t("jobCard.status")}</span>
            <span role="columnheader">{t("jobCard.actions")}</span>
          </div>
          {lines.map((l) => (
            <LineRow key={l.id} card={card} line={l} userId={userId} />
          ))}
        </div>
      )}
    </section>
  );
}

function LineRow({ card, line: l, userId }: { card: CardView; line: LineView; userId: string }) {
  const t = useT();
  const uom = t(`enums.uom.${l.uom}`);
  const uncovered = l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned);
  return (
    <div
      role="row"
      data-testid={`line-${l.sku}`}
      data-status={l.status}
      className={cn("flex flex-col gap-2 border-b px-3 py-3 last:border-b-0", GRID, l.cancelled && "opacity-60")}
    >
      <div role="cell" className="min-w-0">
        <p className="break-words">{l.name}</p>
        {l.name_hi && <p className="text-sm text-muted-foreground">{l.name_hi}</p>}
        <p className="font-mono text-xs text-muted-foreground">{l.sku}</p>
      </div>
      <div className="grid grid-cols-4 gap-2 md:contents">
        <QtyCell label={t("jobCard.required")} value={l.qty_required} uom={uom} />
        <QtyCell label={t("jobCard.reserved")} value={l.qty_reserved} uom={uom} />
        <QtyCell label={t("jobCard.issued")} value={l.qty_issued} uom={uom} />
        <QtyCell label={t("jobCard.returned")} value={l.qty_returned} uom={uom} />
      </div>
      <div role="cell" className="flex min-w-0 flex-wrap items-center gap-1">
        <StatusBadge enum="line_status" value={l.status} />
        {!l.cancelled && <FitBadge line={l} bikeLabel={card.bike_label} />}
        {!l.cancelled && uncovered > 0 && card.status === "confirmed" && l.eta && <EtaBadge part={l.eta} t={t} />}
      </div>
      <div role="cell" className="flex min-w-0 flex-wrap gap-2">
        {!l.cancelled && card.status === "draft" && <SwitchPart line={l} userId={userId} />}
        {!l.cancelled && card.status === "confirmed" && <ChangeQty line={l} userId={userId} />}
        {!l.cancelled && card.status === "confirmed" && uncovered > 0 && l.holders.length > 0 && (
          <Reallocate line={l} uncovered={uncovered} userId={userId} />
        )}
      </div>
    </div>
  );
}

function QtyCell({ label, value, uom }: { label: string; value: number; uom: string }) {
  return (
    <div role="cell" className="flex flex-col tabular-nums">
      <span className="text-xs text-muted-foreground md:hidden">{label}</span>
      <span>
        {value} <span className="text-xs text-muted-foreground">{uom}</span>
      </span>
    </div>
  );
}

/** SPEC §9.2 fit badge from fit_badge(line). */
function FitBadge({ line, bikeLabel }: { line: LineView; bikeLabel: string }) {
  const t = useT();
  const fit = line.fit;
  if (!fit) return null;
  if (fit.badge === "red") {
    return (
      <Badge data-testid="fit" data-fit="red" className="h-auto bg-red-100 whitespace-normal text-red-900 dark:bg-red-950 dark:text-red-100">
        {t("fit.red")}
        {fit.last_flag_note ? ` · ${fit.last_flag_note}` : ""}
      </Badge>
    );
  }
  if (fit.badge === "amber") {
    return (
      <Badge data-testid="fit" data-fit="amber" className="h-auto bg-amber-100 whitespace-normal text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        {t("fit.amber", { bike: bikeLabel })}
      </Badge>
    );
  }
  return (
    <Badge data-testid="fit" data-fit="green" className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
      {line.is_universal ? t("fit.universal") : t("fit.green", { n: fit.confirmed_count })}
    </Badge>
  );
}

/** "1 of N options" switch on draft cards (line_candidates, switch_line_part). */
function SwitchPart({ line, userId }: { line: LineView; userId: string }) {
  const t = useT();
  const current = line.candidates.findIndex((c) => c.is_current);
  const [choice, setChoice] = useState<string | null>(null);
  const others = line.candidates.filter((c) => !c.is_current);
  if (others.length === 0) return null;
  const label =
    current >= 0
      ? t("jobCard.optionOf", { i: current + 1, n: line.candidates.length })
      : t("jobCard.manualOfN", { n: line.candidates.length });
  return (
    <RpcDialog
      userId={userId}
      action={switchLinePart}
      values={() => (choice ? { line_id: line.id, part_id: choice } : null)}
      triggerLabel={label}
      triggerTestId={`switch-${line.sku}`}
      title={t("jobCard.switchTitle", { sku: line.sku })}
      confirmLabel={t("jobCard.switch")}
      onOpenChange={(o) => !o && setChoice(null)}
    >
      <ul className="flex flex-col gap-1">
        {line.candidates.map((c) => {
          const red = c.flagged_count >= Math.max(1, c.confirmed_count);
          return (
            <li key={c.part_id}>
              <label
                className={cn(
                  "flex min-h-11 items-start gap-3 rounded-lg border p-2",
                  c.is_current && "bg-muted",
                  choice === c.part_id && "border-primary",
                )}
              >
                <input
                  type="radio"
                  name={`switch-${line.id}`}
                  className="mt-1 size-5"
                  disabled={c.is_current}
                  checked={choice === c.part_id}
                  onChange={() => setChoice(c.part_id)}
                />
                <span className="min-w-0 break-words">
                  <span className="font-mono text-sm">{c.sku}</span> {c.name}
                  <span className="block text-xs text-muted-foreground">
                    {t(`enums.fitment_source.${c.source}`)} ·{" "}
                    {t("jobCard.counts", { confirmed: c.confirmed_count, flagged: c.flagged_count })}
                    {c.is_current && ` · ${t("jobCard.current")}`}
                  </span>
                  {red && <span className="block text-xs text-destructive">{t("fit.flaggedWarning")}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </RpcDialog>
  );
}

/** set_line_qty (manager): new qty >= issued; 0 with nothing issued cancels the line. */
function ChangeQty({ line, userId }: { line: LineView; userId: string }) {
  const t = useT();
  const [qty, setQty] = useState(line.qty_required);
  const net = line.qty_issued - line.qty_returned;
  return (
    <RpcDialog
      userId={userId}
      action={setLineQty}
      values={(reason) => (qty !== line.qty_required ? { line_id: line.id, qty, reason } : null)}
      triggerLabel={t("jobCard.changeQty")}
      triggerTestId={`qty-${line.sku}`}
      title={t("jobCard.changeQtyTitle", { sku: line.sku })}
      description={net > 0 ? t("jobCard.changeQtyMin", { n: net }) : t("jobCard.changeQtyZero")}
      confirmLabel={t("jobCard.saveQty")}
      reason="required"
      onOpenChange={(o) => !o && setQty(line.qty_required)}
    >
      <QtyStepper label={t("jobCard.required")} value={qty} onChange={setQty} min={0} max={999} uom={line.uom} />
    </RpcDialog>
  );
}

/** reallocate_reservation (manager): take reserved units from another bike's line of this part. */
function Reallocate({ line, uncovered, userId }: { line: LineView; uncovered: number; userId: string }) {
  const t = useT();
  const [from, setFrom] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const holder = line.holders.find((h) => h.line_id === from);
  const max = holder ? Math.min(holder.qty_reserved, uncovered) : 1;
  return (
    <RpcDialog
      userId={userId}
      action={reallocate}
      values={(reason) =>
        holder ? { from_line_id: holder.line_id, to_line_id: line.id, qty: Math.min(qty, max), reason } : null
      }
      triggerLabel={t("jobCard.reallocate")}
      triggerTestId={`reallocate-${line.sku}`}
      title={t("jobCard.reallocateTitle", { sku: line.sku })}
      description={t("jobCard.reallocateBody", { n: uncovered })}
      confirmLabel={t("jobCard.reallocate")}
      reason="required"
      onOpenChange={(o) => {
        if (!o) {
          setFrom(null);
          setQty(1);
        }
      }}
    >
      <ul className="flex flex-col gap-1">
        {line.holders.map((h) => (
          <li key={h.line_id}>
            <label className={cn("flex min-h-11 items-start gap-3 rounded-lg border p-2", from === h.line_id && "border-primary")}>
              <input
                type="radio"
                name={`from-${line.id}`}
                className="mt-1 size-5"
                checked={from === h.line_id}
                onChange={() => {
                  setFrom(h.line_id);
                  setQty(Math.min(h.qty_reserved, uncovered));
                }}
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span>
                  <span className="font-mono">{h.reg_no}</span> · <span className="font-mono text-sm">{h.card_code}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1 text-xs">
                  <StatusBadge enum="bike_status" value={h.bike_status} />
                  {h.blocked && <Badge variant="secondary">{t("jobCard.holderBlocked")}</Badge>}
                  <span>{t("jobCard.holderReserved", { n: h.qty_reserved, uom: t(`enums.uom.${line.uom}`) })}</span>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {holder && <QtyStepper label={t("jobCard.qty")} value={Math.min(qty, max)} onChange={setQty} min={1} max={max} uom={line.uom} />}
    </RpcDialog>
  );
}
