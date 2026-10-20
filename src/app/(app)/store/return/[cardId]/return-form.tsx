"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BinPicker, type BinOption } from "@/components/bin-picker";
import { ErrorDetail } from "@/components/error-detail";
import { Field } from "@/components/forms/field";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { RETURN_REASONS, returnNeedsBin, returnNoteOk, type ReturnReason } from "@/lib/store";
import { useRpcForm } from "@/lib/use-rpc-form";
import { cn } from "@/lib/utils";
import { returnFromJobCard, type ReturnResult } from "../../actions";

export type ReturnLine = {
  id: string;
  sku: string;
  name: string;
  name_hi: string | null;
  uom: Database["public"]["Enums"]["uom"];
  net_issued: number;
  suggested: BinOption | null;
};

/** Line → reason (4 large buttons) → bin (not for damaged) → note (wrong fit) → qty → Return. */
export function ReturnForm({
  userId,
  workshopCode,
  lines,
  bins,
  quarantineCode,
  preselect,
  doneHref,
}: {
  userId: string;
  workshopCode: string;
  lines: ReturnLine[];
  bins: BinOption[];
  quarantineCode: string;
  preselect: string | null;
  /** Template with {move}, {again} and {others} (units reserved again for this line / others). */
  doneHref: string;
}) {
  const t = useT();
  const router = useRouter();
  const [lineId, setLineId] = useState<string | null>(preselect ?? (lines.length === 1 ? lines[0].id : null));
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [binId, setBinId] = useState<string | null>(() => lines.find((l) => l.id === lineId)?.suggested?.id ?? null);
  const [binKey, setBinKey] = useState(0);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const line = lines.find((l) => l.id === lineId) ?? null;
  const form = useRpcForm(returnFromJobCard, {
    userId,
    onSuccess: (data: ReturnResult) => {
      const again = data.allocated.filter((a) => a.line_id === data.line.line_id).reduce((s, a) => s + a.qty, 0);
      const others = data.allocated.filter((a) => a.line_id !== data.line.line_id).reduce((s, a) => s + a.qty, 0);
      router.replace(
        doneHref.replace("{move}", String(data.move_id)).replace("{again}", String(again)).replace("{others}", String(others)),
      );
    },
  });

  const pickLine = (l: ReturnLine) => {
    setLineId(l.id);
    setQty(1);
    setBinId(l.suggested?.id ?? null);
    setBinKey((k) => k + 1);
    form.reset();
  };
  const needsBin = reason ? returnNeedsBin(reason) : false;
  const ready =
    line !== null && reason !== null && (!needsBin || binId !== null) && returnNoteOk(reason, note) && qty >= 1 && qty <= line.net_issued;
  const run = () => {
    if (!ready || !line || !reason) return;
    form.submit({
      line_id: line.id,
      qty,
      reason,
      to_bin_id: needsBin ? binId : null,
      note: note.trim() || null,
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="return-form">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-semibold">{t("returns.pickLine")}</legend>
        {lines.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={l.id === lineId}
            onClick={() => pickLine(l)}
            className={cn(
              "flex min-h-14 flex-col items-start gap-0.5 rounded-xl border p-3 text-left",
              l.id === lineId && "border-primary bg-primary/5",
            )}
            data-testid={`return-line-${l.sku}`}
          >
            <span className="font-mono text-sm">{l.sku}</span>
            <span className="break-words">{l.name}</span>
            {l.name_hi && <span className="text-sm text-muted-foreground">{l.name_hi}</span>}
            <span className="text-sm tabular-nums">{t("returns.withBike", { qty: l.net_issued, uom: t(`enums.uom.${l.uom}`) })}</span>
          </button>
        ))}
      </fieldset>

      {line && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-semibold">{t("returns.reasonTitle")}</legend>
          <div className="grid grid-cols-2 gap-2">
            {RETURN_REASONS.map((r) => (
              <Button
                key={r}
                type="button"
                variant={reason === r ? "default" : "outline"}
                aria-pressed={reason === r}
                className="h-16 text-base whitespace-normal"
                onClick={() => {
                  setReason(r);
                  form.reset();
                }}
                data-testid={`reason-${r}`}
              >
                {t(`returns.reason.${r}`)}
              </Button>
            ))}
          </div>
          {reason && <p className="text-sm text-muted-foreground">{t(`returns.hint.${reason}`, { bin: quarantineCode })}</p>}
        </fieldset>
      )}

      {line && reason && (
        <>
          {needsBin && (
            <BinPicker
              key={binKey}
              bins={bins}
              workshopCode={workshopCode}
              value={binId}
              onChange={setBinId}
              suggested={line.suggested}
              label={t("returns.bin")}
              testId="return-bin"
            />
          )}
          <QtyStepper
            label={t("returns.qty")}
            value={qty}
            min={1}
            max={line.net_issued}
            onChange={setQty}
            uom={line.uom}
            testId="return-qty"
          />
          <Field label={reason === "wrong_fitment" ? t("returns.noteWrongFit") : t("returns.note")}>
            {(id) => (
              <Textarea
                id={id}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                className="text-base md:text-base"
                data-testid="return-note"
              />
            )}
          </Field>
        </>
      )}

      <RpcFormStatus state={form.state} onRetry={run} />
      <ErrorDetail state={form.state} />
      <div className="sticky bottom-0 bg-background py-2">
        <Button
          type="button"
          className="h-14 w-full text-base"
          disabled={form.disabled || !ready}
          onClick={run}
          data-testid="return-submit"
        >
          {form.pending ? t("rpcForm.saving") : t("returns.submit", { qty, uom: line ? t(`enums.uom.${line.uom}`) : "" })}
        </Button>
      </div>
    </div>
  );
}
