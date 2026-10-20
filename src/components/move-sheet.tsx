"use client";

import { useState } from "react";
import { moveStockFromStore, type MoveResult } from "@/app/(app)/store/actions";
import { BinPicker, type BinOption } from "@/components/bin-picker";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcDialog } from "@/components/rpc-dialog";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";

type Uom = Database["public"]["Enums"]["uom"];

/**
 * "Move to another bin": the compensating action on a success screen (SPEC §14 undo is a move,
 * never an edit). Moves a part out of the bin it just went into (normal or receiving) to another
 * normal bin. Shows the outcome in place after the sheet closes.
 */
export function MoveSheet({
  userId,
  workshopCode,
  part,
  from,
  bins,
}: {
  userId: string;
  workshopCode: string;
  part: { id: string; sku: string; uom: Uom };
  from: { id: string; code: string; on_hand: number };
  /** Active normal bins of the workshop (the source bin is left out). */
  bins: BinOption[];
}) {
  const t = useT();
  const targets = bins.filter((b) => b.id !== from.id);
  const [binId, setBinId] = useState<string | null>(null);
  const [qty, setQty] = useState(Math.max(1, from.on_hand));
  const [formKey, setFormKey] = useState(0);
  const [done, setDone] = useState<{ code: string; result: MoveResult } | null>(null);
  const bin = targets.find((b) => b.id === binId);
  const uom = t(`enums.uom.${part.uom}`);
  if (from.on_hand <= 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {done && (
        <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50" data-testid="move-done">
          {t("move.done", { qty: done.result.qty, uom, sku: part.sku, from: from.code, to: done.code, now: done.result.to_on_hand })}
        </p>
      )}
      {!done && (
        <RpcDialog
          userId={userId}
          action={moveStockFromStore}
          values={() => (binId ? { part_id: part.id, from_bin_id: from.id, to_bin_id: binId, qty, reason: "" } : null)}
          triggerLabel={t("move.trigger")}
          triggerClassName="h-12 w-full text-base"
          triggerTestId="move-to-bin"
          title={t("move.title", { sku: part.sku, from: from.code })}
          confirmLabel={t("move.confirm", { qty, uom, code: bin?.code ?? "…" })}
          onSuccess={(data) => setDone({ code: bin?.code ?? "", result: data as unknown as MoveResult })}
          onOpenChange={(open) => {
            if (!open) {
              setBinId(null);
              setQty(Math.max(1, from.on_hand));
              setFormKey((k) => k + 1);
            }
          }}
        >
          <BinPicker key={formKey} bins={targets} workshopCode={workshopCode} value={binId} onChange={setBinId} testId="move-bin" />
          <QtyStepper label={t("move.qty")} value={qty} min={1} max={Math.min(999, from.on_hand)} onChange={setQty} uom={part.uom} />
        </RpcDialog>
      )}
    </div>
  );
}
