"use client";

import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, inputClass } from "@/components/forms/field";
import { MoneyInput } from "@/components/money-input";
import { PartPicker, type PartHit } from "@/components/part-picker";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcButton, RpcDialog } from "@/components/rpc-dialog";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { ErrorDetail } from "@/components/error-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { formatINR, paiseToInput } from "@/lib/money";
import { whatsappUrl } from "@/lib/purchasing";
import { formatDateOnly } from "@/lib/time";
import { useRpcForm } from "@/lib/use-rpc-form";
import {
  addDraftLine,
  cancelPo,
  removeDraftLine,
  sendPo,
  setPoExpectedOn,
  shortClosePo,
  updateDraftLine,
  type SendResult,
} from "../actions";

type Uom = Database["public"]["Enums"]["uom"];
type PoStatus = Database["public"]["Enums"]["po_status"];

export type PoSummary = {
  id: string;
  code: string;
  status: PoStatus;
  supplier_name: string;
  supplier_phone: string | null;
  line_count: number;
  total_paise: number;
  missing_price_count: number;
  expected_preview: string;
  qty_accepted: number;
};

/** Send (draft) and, after sending, the WhatsApp message with Copy and Open WhatsApp (SPEC §7.3). */
export function SendPoArea({ userId, po }: { userId: string; po: PoSummary }) {
  const t = useT();
  const [sent, setSent] = useState<SendResult | null>(null);
  const [copied, setCopied] = useState(false);

  if (sent) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(sent.whatsapp_text);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <section className="mb-4 flex flex-col gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950" data-testid="po-sent">
        <p role="status" className="font-medium">
          {t("purchasing.sentDone", { code: po.code, date: formatDateOnly(sent.po.expected_on) })}
        </p>
        <Textarea readOnly value={sent.whatsapp_text} className="min-h-48 font-mono text-sm" data-testid="whatsapp-text" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={copy}>
            <CopyIcon className="size-4" /> {copied ? t("purchasing.copied") : t("purchasing.copy")}
          </Button>
          <Button asChild className="h-11">
            <a href={whatsappUrl(po.supplier_phone, sent.whatsapp_text)} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-4" /> {t("purchasing.openWhatsApp")}
            </a>
          </Button>
        </div>
      </section>
    );
  }
  if (po.status !== "draft") return null;

  const blocked = po.line_count === 0 || po.missing_price_count > 0;
  return (
    <section className="mb-4 flex flex-col gap-1">
      <RpcDialog
        userId={userId}
        action={sendPo}
        values={() => (blocked ? null : { po_id: po.id })}
        triggerLabel={t("purchasing.send")}
        triggerVariant="default"
        triggerClassName="h-12 text-base"
        triggerTestId="send-po"
        disabled={blocked}
        title={t("purchasing.sendTitle", { code: po.code })}
        confirmLabel={t("purchasing.sendConfirm")}
        sheet
        effects={[
          t("purchasing.sendEffectSupplier", { name: po.supplier_name }),
          t("purchasing.sendEffectLines", { n: po.line_count }),
          t("purchasing.sendEffectTotal", { total: formatINR(po.total_paise) }),
          t("purchasing.sendEffectExpected", { date: formatDateOnly(po.expected_preview) }),
          t("purchasing.sendEffectLocked"),
        ]}
        onSuccess={(data) => setSent(data as unknown as SendResult)}
      />
      {po.missing_price_count > 0 && (
        <p className="text-sm text-destructive">{t("purchasing.sendNeedsPrices", { n: po.missing_price_count })}</p>
      )}
    </section>
  );
}

type Why = {
  usable: number;
  onOrder: number;
  demand: number;
  projected: number;
  rop: number | null;
  avgDaily: string;
  isAuto: boolean;
  enoughHistory: boolean;
  orderQty: number;
  yesterday: string;
};

type DraftLine = {
  id: string;
  sku: string;
  name: string;
  name_hi: string | null;
  uom: Uom;
  qty: number;
  unit_price_paise: number | null;
  source: "suggested" | "manual";
};

/** One draft line: suggested/manual badge, why-suggested, editable qty and price, remove. */
export function DraftLineRow({ userId, line, why }: { userId: string; line: DraftLine; why: Why | null }) {
  const t = useT();
  const [qty, setQty] = useState(line.qty);
  const initialText = paiseToInput(line.unit_price_paise === null ? null : Number(line.unit_price_paise));
  const [price, setPrice] = useState<{ paise: number | null; text: string }>({
    paise: line.unit_price_paise === null ? null : Number(line.unit_price_paise),
    text: initialText,
  });
  const save = useRpcForm(updateDraftLine, { userId });
  const priceOk = price.text.trim() === "" || price.paise !== null;
  const dirty = qty !== line.qty || price.text !== initialText;
  const run = () =>
    save.submit({ line_id: line.id, qty, unit_price_paise: price.text.trim() === "" ? null : price.paise });

  return (
    <li className="flex flex-col gap-2 rounded-xl border p-3" data-testid={`draft-line-${line.sku}`}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{line.sku}</span>
        <Badge variant={line.source === "suggested" ? "secondary" : "outline"}>
          {t(`purchasing.source_${line.source}`)}
        </Badge>
        {line.unit_price_paise === null && <Badge variant="destructive">{t("purchasing.noPrice")}</Badge>}
      </p>
      <p className="break-words">{line.name}</p>
      {line.name_hi && <p className="text-sm text-muted-foreground">{line.name_hi}</p>}
      {why && (
        <details className="rounded-lg bg-muted/50 p-2 text-sm">
          <summary className="min-h-8 cursor-pointer font-medium">{t("purchasing.whySuggested")}</summary>
          <ul className="mt-1 space-y-0.5">
            <li>{t("purchasing.whyStock", { usable: why.usable, onOrder: why.onOrder, demand: why.demand })}</li>
            <li>{t("purchasing.whyProjected", { projected: why.projected })}</li>
            {why.isAuto ? (
              <li>{t("purchasing.whyRop", { rop: why.rop ?? 0, avg: why.avgDaily })}</li>
            ) : (
              <li>{t("purchasing.whyOnDemand")}</li>
            )}
            <li>{t("purchasing.whyOrder", { n: why.orderQty })}</li>
            <li className="text-muted-foreground">
              {why.enoughHistory ? t("purchasing.basedOn", { date: why.yesterday }) : t("purchasing.notEnoughHistory")}
            </li>
          </ul>
        </details>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <QtyStepper label={t("purchasing.qty")} value={qty} onChange={setQty} uom={line.uom} />
        <MoneyInput
          label={t("purchasing.unitPrice")}
          defaultValue={initialText}
          onChange={(paise, text) => setPrice({ paise, text })}
          invalid={!priceOk}
          className="w-44"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-11" disabled={save.disabled || !dirty || !priceOk} onClick={run}>
          {save.pending ? t("rpcForm.saving") : t("purchasing.saveLine")}
        </Button>
        <RpcButton
          userId={userId}
          action={removeDraftLine}
          values={{ line_id: line.id }}
          label={t("purchasing.removeLine")}
          variant="outline"
          testId={`remove-${line.sku}`}
        />
      </div>
      <RpcFormStatus state={save.state} onRetry={run} />
      <ErrorDetail state={save.state} />
    </li>
  );
}

/** Add a part to this draft (manual line, SPEC §7.2). */
export function AddDraftLine({ userId, workshopId, supplierId }: { userId: string; workshopId: string; supplierId: string }) {
  const t = useT();
  const [part, setPart] = useState<PartHit | null>(null);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState<{ paise: number | null; text: string }>({ paise: null, text: "" });
  const priceOk = price.text.trim() === "" || price.paise !== null;
  return (
    <div className="mt-3">
      <RpcDialog
        userId={userId}
        action={addDraftLine}
        values={() =>
          part && priceOk
            ? {
                workshop_id: workshopId,
                supplier_id: supplierId,
                part_id: part.part_id,
                qty,
                unit_price_paise: price.text.trim() === "" ? null : price.paise,
              }
            : null
        }
        triggerLabel={t("purchasing.addLine")}
        triggerTestId="add-po-line"
        title={t("purchasing.addLine")}
        confirmLabel={t("purchasing.addLine")}
        onOpenChange={(open) => {
          if (!open) {
            setPart(null);
            setQty(1);
            setPrice({ paise: null, text: "" });
          }
        }}
      >
        <PartPicker workshopId={workshopId} onPick={setPart} selectedId={part?.part_id} />
        {part && (
          <>
            <QtyStepper label={t("purchasing.qty")} value={qty} onChange={setQty} uom={part.uom} />
            <MoneyInput
              label={t("purchasing.unitPriceOptional")}
              onChange={(paise, text) => setPrice({ paise, text })}
              invalid={!priceOk}
            />
          </>
        )}
      </RpcDialog>
    </div>
  );
}

/** Change the expected date of a sent PO (date >= IST today, SPEC §7.3). */
export function ExpectedOnEdit({ userId, poId, current, today }: { userId: string; poId: string; current: string; today: string }) {
  const t = useT();
  const [date, setDate] = useState(current);
  const { submit, pending, disabled, state } = useRpcForm(setPoExpectedOn, { userId });
  const run = () => submit({ po_id: poId, date });
  return (
    <section className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("purchasing.expectedDate")} className="w-48">
          {(id) => (
            <Input id={id} type="date" min={today} className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
        <Button type="button" className="h-12" disabled={disabled || !date || date === current || date < today} onClick={run}>
          {pending ? t("rpcForm.saving") : t("purchasing.saveExpected")}
        </Button>
      </div>
      <RpcFormStatus state={state} onRetry={run} />
      <ErrorDetail state={state} />
    </section>
  );
}

type OpenLine = { id: string; sku: string; open: number; uom: Uom };

/** Short-close chosen open lines with a reason (SPEC §7.5); confirmation sheet lists the effects. */
export function ShortClose({ userId, poId, lines }: { userId: string; poId: string; lines: OpenLine[] }) {
  const t = useT();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(lines.map((l) => l.id)));
  const picked = lines.filter((l) => chosen.has(l.id));
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <RpcDialog
      userId={userId}
      action={shortClosePo}
      values={(reason) => (picked.length > 0 ? { po_id: poId, line_ids: picked.map((l) => l.id), reason } : null)}
      triggerLabel={t("purchasing.shortClose")}
      triggerTestId="short-close"
      title={t("purchasing.shortCloseTitle")}
      confirmLabel={t("purchasing.shortCloseConfirm", { n: picked.length })}
      sheet
      effects={
        picked.length === 0
          ? [t("purchasing.shortCloseNone")]
          : [
              ...picked.map((l) => t("purchasing.shortCloseEffect", { sku: l.sku, qty: l.open, uom: t(`enums.uom.${l.uom}`) })),
              t("purchasing.shortCloseNoReceive"),
            ]
      }
      reason="required"
      destructive
      onOpenChange={(open) => {
        if (open) setChosen(new Set(lines.map((l) => l.id)));
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t("purchasing.shortCloseLines")}</legend>
        {lines.map((l) => (
          <label key={l.id} className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" className="size-5" checked={chosen.has(l.id)} onChange={() => toggle(l.id)} />
            <span className="font-mono text-sm">{l.sku}</span>
            <span>{t("purchasing.openQtyUom", { n: l.open, uom: t(`enums.uom.${l.uom}`) })}</span>
          </label>
        ))}
      </fieldset>
    </RpcDialog>
  );
}

/** Cancel: a draft is deleted; a sent PO with nothing accepted has every line cancelled (SPEC §7.5). */
export function CancelPo({ userId, po, listHref }: { userId: string; po: PoSummary; listHref: string }) {
  const t = useT();
  const router = useRouter();
  const isDraft = po.status === "draft";
  return (
    <RpcDialog
      userId={userId}
      action={cancelPo}
      values={(reason) => ({ po_id: po.id, reason })}
      triggerLabel={isDraft ? t("purchasing.deleteDraft") : t("purchasing.cancelPo")}
      triggerVariant="outline"
      triggerTestId="cancel-po"
      title={t("purchasing.cancelTitle", { code: po.code })}
      confirmLabel={isDraft ? t("purchasing.deleteDraft") : t("purchasing.cancelPo")}
      sheet
      effects={
        isDraft
          ? [t("purchasing.cancelEffectDraft", { n: po.line_count })]
          : [t("purchasing.cancelEffectSent", { n: po.line_count }), t("purchasing.cancelEffectTell", { name: po.supplier_name })]
      }
      reason="required"
      destructive
      onSuccess={() => {
        if (isDraft) router.push(listHref);
      }}
    />
  );
}
