"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ErrorDetail } from "@/components/error-detail";
import { Field, inputClass } from "@/components/forms/field";
import { MoneyInput } from "@/components/money-input";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Constants, type Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";
import { emergencyIssued, emergencyQtyCap, isHighPremium, premiumPercent } from "@/lib/store";
import { useRpcForm } from "@/lib/use-rpc-form";
import { cn } from "@/lib/utils";
import { recordEmergencyBuy, type EmergencyResult } from "../../actions";

type Enums = Database["public"]["Enums"];
type Reason = Enums["emergency_reason"];

/**
 * Emergency buy form (SPEC §8.3): vendor, qty (capped at the remaining need; a second tap allows
 * more, which goes to stock), price with the live premium vs reference (red above 25%), reason,
 * note, then a confirmation sheet listing the effects. The buy is always recorded (money spent).
 */
export function EmergencyForm({
  userId,
  lineId,
  part,
  card,
  remainingNeed,
  cardOk,
  referencePaise,
  receivingCode,
  doneHref,
}: {
  userId: string;
  lineId: string;
  part: { sku: string; uom: Enums["uom"] };
  card: { code: string; reg: string };
  remainingNeed: number;
  cardOk: boolean;
  referencePaise: number | null;
  receivingCode: string;
  /** Template with {buy} and {warning}. */
  doneHref: string;
}) {
  const t = useT();
  const router = useRouter();
  const [vendor, setVendor] = useState("");
  const [override, setOverride] = useState(remainingNeed <= 0);
  const cap = emergencyQtyCap(remainingNeed, override);
  const [qty, setQty] = useState(Math.max(1, Math.min(remainingNeed, cap)));
  const [price, setPrice] = useState<number | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [sheet, setSheet] = useState(false);
  const form = useRpcForm(recordEmergencyBuy, {
    userId,
    onSuccess: (data: EmergencyResult) =>
      router.replace(doneHref.replace("{buy}", data.buy_id).replace("{warning}", data.warning ?? "")),
  });

  const uom = t(`enums.uom.${part.uom}`);
  const issued = emergencyIssued(qty, remainingNeed, cardOk);
  const toStock = qty - issued;
  const pct = price === null ? null : premiumPercent(price, referencePaise);
  const high = price !== null && isHighPremium(price, referencePaise);
  const ready = vendor.trim().length > 0 && price !== null && reason !== null && qty >= 1 && qty <= cap;
  const post = () => {
    if (!ready || price === null || reason === null) return;
    setSheet(false);
    form.submit({ line_id: lineId, qty, unit_price_paise: price, vendor_name: vendor.trim(), reason, note: note.trim() || null });
  };

  const effects = [
    price !== null ? t("emergency.effectPay", { total: formatINR(price * qty), vendor: vendor.trim(), qty, price: formatINR(price) }) : "",
    issued > 0 ? t("emergency.effectIssue", { n: issued, uom, code: card.code, reg: card.reg }) : "",
    toStock > 0 ? t("emergency.effectStock", { n: toStock, uom, bin: receivingCode }) : "",
    pct !== null && pct > 0 ? t("emergency.effectPremium", { pct }) : "",
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4" data-testid="emergency-form">
      <Field label={t("emergency.vendor")}>
        {(id) => (
          <Input
            id={id}
            value={vendor}
            maxLength={100}
            autoComplete="off"
            onChange={(e) => setVendor(e.target.value)}
            className={inputClass}
            data-testid="emergency-vendor"
          />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <QtyStepper label={t("emergency.qty")} value={qty} min={1} max={cap} onChange={setQty} uom={part.uom} testId="emergency-qty" />
        {!override && qty >= cap && (
          <Button type="button" variant="ghost" className="h-11 justify-start text-base" onClick={() => setOverride(true)} data-testid="more-than-needed">
            {t("emergency.moreThanNeeded")}
          </Button>
        )}
        {toStock > 0 && <p className="text-sm text-muted-foreground">{t("emergency.moreHint")}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <MoneyInput label={t("emergency.price")} onChange={(paise) => setPrice(paise)} />
        <p className={cn("text-sm tabular-nums", high ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground")} data-testid="premium">
          {referencePaise === null
            ? t("emergency.noReference")
            : pct === null
              ? t("emergency.reference", { price: formatINR(referencePaise) })
              : t("emergency.premium", { pct: pct > 0 ? `+${pct}` : String(pct), price: formatINR(referencePaise) })}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("emergency.reason")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {Constants.public.Enums.emergency_reason.map((r) => (
            <Button
              key={r}
              type="button"
              variant={reason === r ? "default" : "outline"}
              aria-pressed={reason === r}
              className="h-14 text-base whitespace-normal"
              onClick={() => setReason(r)}
              data-testid={`emergency-reason-${r}`}
            >
              {t(`enums.emergency_reason.${r}`)}
            </Button>
          ))}
        </div>
      </fieldset>

      <Field label={t("emergency.note")}>
        {(id) => <Textarea id={id} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="text-base md:text-base" />}
      </Field>

      <RpcFormStatus state={form.state} onRetry={post} />
      <ErrorDetail state={form.state} />
      <div className="sticky bottom-0 bg-background py-2">
        <Button
          type="button"
          className="h-14 w-full text-base"
          disabled={form.disabled || !ready}
          onClick={() => setSheet(true)}
          data-testid="emergency-submit"
        >
          {form.pending ? t("rpcForm.saving") : t("emergency.submit")}
        </Button>
      </div>
      <ConfirmSheet
        open={sheet}
        onOpenChange={setSheet}
        title={t("emergency.sheetTitle")}
        effects={effects}
        confirmLabel={t("emergency.confirm")}
        onConfirm={post}
        pending={form.pending}
        disabled={form.disabled || !ready}
      />
    </div>
  );
}
