"use client";

import { useState } from "react";
import { Field, NativeSelect } from "@/components/forms/field";
import { PartPicker, type PartHit } from "@/components/part-picker";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcDialog } from "@/components/rpc-dialog";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { saveReorderSettings } from "./actions";

export type Setting = {
  part_id: string;
  auto: boolean;
  safety_stock: number;
  max_qty: number;
  preferred_supplier_id: string | null;
};
export type SupplierOption = { id: string; name: string; lead_time_days: number };
type Uom = Database["public"]["Enums"]["uom"];

const DEFAULTS = { auto: true, safety_stock: 0, max_qty: 10, preferred_supplier_id: null as string | null };

function SettingsFields({
  value,
  onChange,
  suppliers,
  uom,
}: {
  uom: Uom;
  value: Omit<Setting, "part_id">;
  onChange: (next: Omit<Setting, "part_id">) => void;
  suppliers: SupplierOption[];
}) {
  const t = useT();
  return (
    <>
      <label className="flex min-h-11 items-center gap-2 text-base">
        <input
          type="checkbox"
          className="size-5"
          checked={value.auto}
          onChange={(e) => onChange({ ...value, auto: e.target.checked })}
        />
        {t("reorder.autoLabel")}
      </label>
      <p className="text-xs text-muted-foreground">{t("reorder.autoHint")}</p>
      <QtyStepper
        label={t("reorder.safetyStock")}
        value={value.safety_stock}
        min={0}
        max={9999}
        onChange={(n) => onChange({ ...value, safety_stock: n })}
        uom={uom}
      />
      <QtyStepper
        label={t("reorder.maxQty")}
        value={value.max_qty}
        min={1}
        max={9999}
        onChange={(n) => onChange({ ...value, max_qty: n })}
        uom={uom}
      />
      <Field label={t("reorder.supplierOverride")} hint={t("reorder.supplierOverrideHint")}>
        {(id) => (
          <NativeSelect
            id={id}
            value={value.preferred_supplier_id ?? ""}
            onChange={(e) => onChange({ ...value, preferred_supplier_id: e.target.value || null })}
          >
            <option value="">{t("reorder.partDefault")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {t("reorder.supplierOption", { name: s.name, days: s.lead_time_days })}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
    </>
  );
}

/** Edit one part's reorder settings for this workshop (auto, safety, max, supplier override). */
export function SettingsDialog({
  userId,
  workshopId,
  part,
  current,
  suppliers,
}: {
  userId: string;
  workshopId: string;
  part: { part_id: string; sku: string; uom: Uom };
  current: Setting | null;
  suppliers: SupplierOption[];
}) {
  const t = useT();
  const initial = current ?? { part_id: part.part_id, ...DEFAULTS, auto: false };
  const [value, setValue] = useState<Omit<Setting, "part_id">>(initial);
  return (
    <RpcDialog
      userId={userId}
      action={saveReorderSettings}
      values={() => ({ workshop_id: workshopId, part_id: part.part_id, ...value })}
      triggerLabel={t("reorder.settings")}
      triggerTestId={`settings-${part.sku}`}
      title={t("reorder.settingsTitle", { sku: part.sku })}
      description={current ? undefined : t("reorder.noSettingsYet")}
      confirmLabel={t("reorder.saveSettings")}
      onOpenChange={(open) => {
        if (open) setValue(initial);
      }}
    >
      <SettingsFields value={value} onChange={setValue} suppliers={suppliers} uom={part.uom} />
    </RpcDialog>
  );
}

/** Add reorder settings for a part that is not listed yet. */
export function AddSetting({ userId, workshopId, suppliers }: { userId: string; workshopId: string; suppliers: SupplierOption[] }) {
  const t = useT();
  const [part, setPart] = useState<PartHit | null>(null);
  const [value, setValue] = useState<Omit<Setting, "part_id">>(DEFAULTS);
  return (
    <RpcDialog
      userId={userId}
      action={saveReorderSettings}
      values={() => (part ? { workshop_id: workshopId, part_id: part.part_id, ...value } : null)}
      triggerLabel={t("reorder.addSetting")}
      triggerTestId="add-reorder-setting"
      title={t("reorder.addSetting")}
      confirmLabel={t("reorder.saveSettings")}
      onOpenChange={(open) => {
        if (!open) {
          setPart(null);
          setValue(DEFAULTS);
        }
      }}
    >
      <PartPicker workshopId={workshopId} onPick={setPart} selectedId={part?.part_id} />
      {part && <SettingsFields value={value} onChange={setValue} suppliers={suppliers} uom={part.uom} />}
    </RpcDialog>
  );
}
