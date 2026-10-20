"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { EmptyState } from "@/components/empty-state";
import { ErrorDetail } from "@/components/error-detail";
import { Field, inputClass } from "@/components/forms/field";
import { ListSkeleton } from "@/components/list-skeleton";
import { MoneyInput } from "@/components/money-input";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/lib/database.types";
import {
  browserStorage,
  clearGrnDraft,
  loadGrnDraft,
  saveGrnDraft,
  type GrnDraft,
  type GrnDraftLine,
} from "@/lib/grn-draft";
import { useT } from "@/lib/i18n/client";
import { formatINR, paiseToInput, rupeesToPaise } from "@/lib/money";
import { acceptedQty, priceVariance } from "@/lib/purchasing";
import { formatDateOnly, formatDuration, formatIST } from "@/lib/time";
import { useRpcForm } from "@/lib/use-rpc-form";
import { cn } from "@/lib/utils";
import { receiveGrn, type GrnResult } from "../../actions";

type Uom = Database["public"]["Enums"]["uom"];
type Line = { id: string; sku: string; name: string; name_hi: string | null; uom: Uom; price_paise: number };

type Props = {
  userId: string;
  po: { id: string; code: string };
  /** False once the PO is received/closed or has no open line (the form then shows why). */
  receivable: boolean;
  lines: Line[];
  today: string;
  rcvBinCode: string;
  /** issue contains "{id}" for the job card id. */
  links: { list: string; putaway: string; issue: string };
};

const noop = () => () => {};

/**
 * Blind receiving (SPEC §7.4): the form mounts only in the browser, because the store keeper's
 * entries and request_id come back from localStorage (24 h, per PO and user).
 */
export function ReceiveForm(props: Props) {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  if (!hydrated) return <ListSkeleton rows={props.lines.length || 2} />;
  return <ReceiveFormInner {...props} />;
}

function emptyLine(line: Line): GrnDraftLine {
  return { received: null, damagedOpen: false, damaged: 0, wrongPart: 0, priceText: paiseToInput(line.price_paise) };
}

type OverReceipt = { po_line_id: string; ordered: number; accepted_so_far: number; max_now: number };
type DuplicateInvoice = { grn_code: string; received_by_name: string | null; received_at: string; invoice_date: string };

function ReceiveFormInner({ userId, po, receivable, lines, today, rcvBinCode, links }: Props) {
  const t = useT();
  // The success screen keeps the lines it posted (after the refresh the PO may have none open).
  const [postedLines] = useState(lines);
  // Read once on mount (the component only renders in the browser).
  const [draft] = useState<GrnDraft | null>(() => loadGrnDraft(browserStorage(), po.id, userId, Date.now()));
  const [invoiceNo, setInvoiceNo] = useState(draft?.invoiceNo ?? "");
  const [invoiceDate, setInvoiceDate] = useState(draft?.invoiceDate ?? "");
  const [entries, setEntries] = useState<Record<string, GrnDraftLine>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, draft?.lines[l.id] ?? emptyLine(l)])),
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [lastAllow, setLastAllow] = useState(false);

  const form = useRpcForm(receiveGrn, {
    userId,
    initialRequestId: () => draft?.requestId ?? null,
    onSuccess: () => clearGrnDraft(browserStorage(), po.id, userId),
  });
  const done = form.state.kind === "ok";
  const { getRequestId } = form;

  // Every change is saved with the request_id, so a reload or retry reuses both.
  useEffect(() => {
    if (done) return;
    const touched =
      invoiceNo !== "" || invoiceDate !== "" || Object.values(entries).some((e) => e.received !== null || e.damagedOpen);
    if (!touched) clearGrnDraft(browserStorage(), po.id, userId);
    else saveGrnDraft(browserStorage(), po.id, userId, { requestId: getRequestId(), invoiceNo, invoiceDate, lines: entries }, Date.now());
  }, [done, entries, invoiceNo, invoiceDate, getRequestId, po.id, userId]);

  if (form.state.kind === "ok") return <Success result={form.state.data} lines={postedLines} links={links} />;
  if (!receivable)
    return (
      <EmptyState
        message={t("receive.notReceivable")}
        action={
          <Button asChild variant="outline" className="h-12">
            <Link href={links.list}>{t("receive.backToList")}</Link>
          </Button>
        }
      />
    );

  const setLine = (id: string, patch: Partial<GrnDraftLine>) =>
    setEntries((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const computed = lines.map((l) => {
    const e = entries[l.id];
    const accepted = acceptedQty(e.received, e.damaged, e.wrongPart);
    const pricePaise = rupeesToPaise(e.priceText);
    const active = (e.received ?? 0) > 0;
    const lineError = active && accepted !== null && accepted < 0 ? "receive.rejectedTooMany" : active && pricePaise === null ? "validation.money" : null;
    return { line: l, entry: e, accepted, pricePaise, active, lineError, variance: active && priceVariance(l.price_paise, pricePaise) };
  });
  const activeLines = computed.filter((c) => c.active);
  const invoiceError = invoiceNo.trim().length === 0 ? "validation.required" : invoiceNo.trim().length > 40 ? "validation.tooLong" : null;
  const dateError = !invoiceDate ? "validation.required" : invoiceDate > today ? "receive.dateInFuture" : null;
  const nothing = activeLines.length === 0;
  const invalid = Boolean(invoiceError || dateError || nothing || computed.some((c) => c.lineError));

  const values = (allowDuplicate: boolean) => ({
    po_id: po.id,
    supplier_invoice_no: invoiceNo.trim(),
    invoice_date: invoiceDate,
    allow_duplicate_invoice: allowDuplicate,
    lines: activeLines.map((c) => ({
      po_line_id: c.line.id,
      qty_received: c.entry.received ?? 0,
      qty_damaged: c.entry.damaged,
      qty_wrong_part: c.entry.wrongPart,
      unit_price_paise: c.pricePaise ?? 0,
    })),
  });
  const post = (allowDuplicate: boolean) => {
    setSheetOpen(false);
    setLastAllow(allowDuplicate);
    form.submit(values(allowDuplicate));
  };

  const error = form.state.kind === "error" ? form.state : null;
  const over = error?.code === "OVER_RECEIPT" ? (error.detail as OverReceipt | null) : null;
  const duplicate = error?.code === "DUPLICATE_INVOICE" ? (error.detail as DuplicateInvoice | null) : null;
  const uomOf = (l: Line) => t(`enums.uom.${l.uom}`);

  const effects = [
    ...activeLines.flatMap((c) => {
      const rejected = c.entry.damaged + c.entry.wrongPart;
      const out = [
        t("receive.effectAccepted", { sku: c.line.sku, qty: c.accepted ?? 0, uom: uomOf(c.line), bin: rcvBinCode }),
      ];
      if (rejected > 0)
        out.push(t("receive.effectRejected", { sku: c.line.sku, qty: rejected, damaged: c.entry.damaged, wrong: c.entry.wrongPart }));
      if (c.variance && c.pricePaise !== null)
        out.push(t("receive.effectVariance", { sku: c.line.sku, price: formatINR(c.pricePaise), po: formatINR(c.line.price_paise) }));
      return out;
    }),
    t("receive.effectInvoice", { no: invoiceNo.trim(), date: invoiceDate ? formatDateOnly(invoiceDate) : "" }),
    t("receive.effectAllocate"),
  ];

  return (
    <div className="flex flex-col gap-4 pb-4">
      <p className="text-sm text-muted-foreground">{t("receive.blindHint")}</p>
      {draft && <p className="rounded-lg bg-muted p-2 text-sm">{t("receive.draftRestored")}</p>}

      <section className="flex flex-col gap-3 rounded-xl border p-3">
        <Field label={t("receive.invoiceNo")} error={showErrors && invoiceError ? t(invoiceError) : null}>
          {(id) => (
            <Input
              id={id}
              className={inputClass}
              value={invoiceNo}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => setInvoiceNo(e.target.value)}
              data-testid="invoice-no"
            />
          )}
        </Field>
        <Field label={t("receive.invoiceDate")} error={showErrors && dateError ? t(dateError) : null}>
          {(id) => (
            <Input
              id={id}
              type="date"
              max={today}
              className={inputClass}
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              data-testid="invoice-date"
            />
          )}
        </Field>
      </section>

      <ul className="flex flex-col gap-3">
        {computed.map((c) => {
          const { line, entry } = c;
          const pinned = over?.po_line_id === line.id ? over : null;
          return (
            <li
              key={line.id}
              className={cn("flex flex-col gap-3 rounded-xl border p-3", pinned && "border-destructive")}
              data-testid={`grn-line-${line.sku}`}
            >
              <div>
                <p className="font-mono text-sm">{line.sku}</p>
                <p className="break-words font-medium">{line.name}</p>
                {line.name_hi && <p className="text-sm text-muted-foreground">{line.name_hi}</p>}
              </div>
              <QtyStepper
                label={t("receive.received")}
                value={entry.received}
                min={0}
                onChange={(n) => setLine(line.id, { received: n })}
                onClear={() => setLine(line.id, { received: null })}
                uom={line.uom}
                testId={`received-${line.sku}`}
              />
              <label className="flex min-h-12 items-center gap-3 text-base">
                <input
                  type="checkbox"
                  role="switch"
                  className="size-6"
                  checked={entry.damagedOpen}
                  onChange={(e) =>
                    setLine(line.id, e.target.checked ? { damagedOpen: true } : { damagedOpen: false, damaged: 0, wrongPart: 0 })
                  }
                  data-testid={`any-damaged-${line.sku}`}
                />
                {t("receive.anyDamaged")}
              </label>
              {entry.damagedOpen && (
                <div className="flex flex-col gap-3 border-l-4 border-amber-300 pl-3">
                  <QtyStepper
                    label={t("receive.damaged")}
                    value={entry.damaged}
                    min={0}
                    onChange={(n) => setLine(line.id, { damaged: n })}
                    uom={line.uom}
                    testId={`damaged-${line.sku}`}
                  />
                  <QtyStepper
                    label={t("receive.wrongPart")}
                    value={entry.wrongPart}
                    min={0}
                    onChange={(n) => setLine(line.id, { wrongPart: n })}
                    uom={line.uom}
                    testId={`wrong-${line.sku}`}
                  />
                  <p className="text-sm text-muted-foreground">{t("receive.handBack")}</p>
                </div>
              )}
              <p className="text-base" data-testid={`accepted-${line.sku}`}>
                {t("receive.accepted")}:{" "}
                <span className="font-semibold tabular-nums">
                  {c.accepted === null ? "–" : `${c.accepted} ${uomOf(line)}`}
                </span>
              </p>
              <MoneyInput
                label={t("receive.invoicePrice")}
                defaultValue={entry.priceText}
                onChange={(_, text) => setLine(line.id, { priceText: text })}
              />
              {c.variance && c.pricePaise !== null && (
                <Badge className="w-fit bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  {t("receive.variance", { po: formatINR(line.price_paise) })}
                </Badge>
              )}
              {showErrors && c.lineError && (
                <p role="alert" className="text-sm text-destructive">
                  {t(c.lineError as "validation.money")}
                </p>
              )}
              {pinned && (
                <p role="alert" className="text-sm text-destructive" data-testid={`over-receipt-${line.sku}`}>
                  {t("receive.overReceipt", {
                    ordered: pinned.ordered,
                    so_far: pinned.accepted_so_far,
                    max: pinned.max_now,
                    uom: uomOf(line),
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {duplicate && (
        <section role="alert" className="flex flex-col gap-2 rounded-xl border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950" data-testid="duplicate-invoice">
          <p className="font-medium">
            {t("receive.duplicate", {
              grn: duplicate.grn_code,
              name: duplicate.received_by_name ?? "–",
              at: formatIST(duplicate.received_at),
              date: formatDateOnly(duplicate.invoice_date),
            })}
          </p>
          <p>{t("receive.duplicateQuestion")}</p>
          <Button type="button" className="h-12 text-base" disabled={form.disabled} onClick={() => post(true)}>
            {t("receive.coversBoth")}
          </Button>
        </section>
      )}

      <RpcFormStatus state={form.state} onRetry={() => post(lastAllow)} />
      {error && !over && !duplicate && <ErrorDetail state={form.state} />}
      {over && <p className="text-sm text-destructive">{error?.message}</p>}
      {showErrors && nothing && <p className="text-sm text-destructive">{t("receive.nothingReceived")}</p>}

      <div className="sticky bottom-0 -mx-4 border-t bg-background px-4 py-3">
        <Button
          type="button"
          className="h-14 w-full text-base"
          disabled={form.disabled}
          onClick={() => {
            setShowErrors(true);
            if (!invalid) setSheetOpen(true);
          }}
          data-testid="post-grn"
        >
          {form.pending ? t("rpcForm.saving") : t("receive.post")}
        </Button>
      </div>

      <ConfirmSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={t("receive.confirmTitle", { code: po.code })}
        effects={effects}
        confirmLabel={t("receive.post")}
        onConfirm={() => post(false)}
        pending={form.pending}
        disabled={form.disabled}
      />
    </div>
  );
}

function Success({ result, lines, links }: { result: GrnResult; lines: Line[]; links: Props["links"] }) {
  const t = useT();
  const uomBySku = new Map(lines.map((l) => [l.sku, l.uom]));
  const uom = (sku: string) => t(`enums.uom.${uomBySku.get(sku) ?? "pcs"}`);
  const [now] = useState(() => Date.now());
  return (
    <section className="flex flex-col gap-4" data-testid="grn-success">
      <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
        <p className="text-lg font-semibold">{t("receive.posted", { code: result.grn.code })}</p>
        <ul className="mt-1 text-sm">
          {result.grn.lines.map((l) => (
            <li key={l.po_line_id}>
              {t("receive.postedLine", {
                sku: l.sku,
                accepted: l.qty_accepted,
                rejected: l.qty_damaged + l.qty_wrong_part,
                uom: uom(l.sku),
              })}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">{t("receive.allocationsTitle")}</h2>
        {result.allocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("receive.noAllocations")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="allocations">
            {result.allocations.map((a) => {
              const cardId = result.card_ids[a.card_code];
              return (
                <li key={a.line_id} className="flex flex-col gap-2 rounded-xl border p-3" data-testid={`allocation-${a.card_code}`}>
                  <p>
                    {t("receive.allocation", { qty: a.qty, uom: uom(a.part), sku: a.part, reg: a.reg_no, card: a.card_code })}{" "}
                    <span className="text-muted-foreground">
                      {a.waiting_since
                        ? t("receive.waiting", { time: formatDuration(a.waiting_since, now, t) })
                        : t("receive.inTransit")}
                    </span>
                  </p>
                  {a.waiting_since && cardId && (
                    <Button asChild className="h-12 text-base">
                      <Link href={links.issue.replace("{id}", cardId)}>{t("receive.issueNow")}</Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="h-12 text-base sm:flex-1">
          <Link href={links.putaway}>{t("receive.putAwayNow")}</Link>
        </Button>
        <Button asChild variant="outline" className="h-12 text-base sm:flex-1">
          <Link href={links.list}>{t("receive.backToList")}</Link>
        </Button>
      </div>
    </section>
  );
}
