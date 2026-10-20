"use client";

import { useState } from "react";
import { BinPicker, type BinOption } from "@/components/bin-picker";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcDialog } from "@/components/rpc-dialog";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { moveStock, returnToSupplier } from "../actions";

type Item = { bin_id: string; bin_code: string; part_id: string; sku: string; uom: Database["public"]["Enums"]["uom"]; on_hand: number };

/** Move out of quarantine after re-inspection (manager, reason required, SPEC §3.4, §8.4). */
export function MoveBack({ userId, workshopCode, item, bins }: { userId: string; workshopCode: string; item: Item; bins: BinOption[] }) {
  const t = useT();
  const [binId, setBinId] = useState<string | null>(null);
  const [qty, setQty] = useState(item.on_hand);
  const [formKey, setFormKey] = useState(0);
  const bin = bins.find((b) => b.id === binId);
  const uom = t(`enums.uom.${item.uom}`);
  return (
    <RpcDialog
      userId={userId}
      action={moveStock}
      values={(reason) => (binId ? { part_id: item.part_id, from_bin_id: item.bin_id, to_bin_id: binId, qty, reason } : null)}
      triggerLabel={t("quarantine.moveBack")}
      triggerTestId={`move-back-${item.sku}`}
      title={t("quarantine.moveBackTitle", { sku: item.sku })}
      confirmLabel={t("quarantine.moveBackConfirm")}
      sheet
      effects={[
        t("quarantine.moveBackEffect", { qty, uom, sku: item.sku, from: item.bin_code, to: bin?.code ?? "…" }),
        t("quarantine.moveBackAllocate"),
      ]}
      reason="required"
      defaultReason={t("quarantine.reinspected")}
      onOpenChange={(open) => {
        if (!open) {
          setBinId(null);
          setQty(item.on_hand);
          setFormKey((k) => k + 1);
        }
      }}
    >
      <BinPicker key={formKey} bins={bins} workshopCode={workshopCode} value={binId} onChange={setBinId} />
      <QtyStepper label={t("quarantine.qty")} value={qty} min={1} max={Math.min(999, item.on_hand)} onChange={setQty} uom={item.uom} />
    </RpcDialog>
  );
}

/** Return quarantined units to the supplier: they leave stock (manager, SPEC §8.4). */
export function ReturnToSupplier({ userId, item }: { userId: string; item: Item }) {
  const t = useT();
  const [qty, setQty] = useState(item.on_hand);
  const uom = t(`enums.uom.${item.uom}`);
  return (
    <RpcDialog
      userId={userId}
      action={returnToSupplier}
      values={(reason) => ({ bin_id: item.bin_id, part_id: item.part_id, qty, reason })}
      triggerLabel={t("quarantine.returnToSupplier")}
      triggerVariant="outline"
      triggerTestId={`rts-${item.sku}`}
      title={t("quarantine.returnTitle", { sku: item.sku })}
      confirmLabel={t("quarantine.returnConfirm")}
      sheet
      destructive
      effects={[t("quarantine.returnEffect", { qty, uom, sku: item.sku, bin: item.bin_code }), t("quarantine.returnEffectNote")]}
      reason="required"
      onOpenChange={(open) => {
        if (!open) setQty(item.on_hand);
      }}
    >
      <QtyStepper label={t("quarantine.qty")} value={qty} min={1} max={Math.min(999, item.on_hand)} onChange={setQty} uom={item.uom} />
    </RpcDialog>
  );
}
