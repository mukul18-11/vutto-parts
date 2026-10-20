"use client";

import { useState } from "react";
import { Field, NativeSelect } from "@/components/forms/field";
import { MoneyInput } from "@/components/money-input";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcDialog } from "@/components/rpc-dialog";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { addDraftLine } from "./actions";

type Part = { part_id: string; sku: string; name: string; qty: number; uom: Database["public"]["Enums"]["uom"] };
type Supplier = { id: string; name: string; city: string | null; lead_time_days: number };

/** SPEC §7.1 step 4: parts with a requirement but no effective supplier; "Add to draft" picks one. */
export function NeedsSupplier({
  userId,
  workshopId,
  parts,
  suppliers,
}: {
  userId: string;
  workshopId: string;
  parts: Part[];
  suppliers: Supplier[];
}) {
  const t = useT();
  return (
    <section
      aria-labelledby="needs-supplier-title"
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
      data-testid="needs-supplier"
    >
      <h2 id="needs-supplier-title" className="font-semibold">
        {t("purchasing.needsSupplierTitle")}
      </h2>
      <p className="mb-2 text-sm">{t("purchasing.needsSupplierHint")}</p>
      <ul className="flex flex-col gap-2">
        {parts.map((p) => (
          <li key={p.part_id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="font-mono text-sm">{p.sku}</span> <span className="break-words">{p.name}</span>{" "}
              <span className="text-sm text-muted-foreground">({t("purchasing.needQty", { n: p.qty, uom: t(`enums.uom.${p.uom}`) })})</span>
            </span>
            <AddToDraft userId={userId} workshopId={workshopId} part={p} suppliers={suppliers} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddToDraft({
  userId,
  workshopId,
  part,
  suppliers,
}: {
  userId: string;
  workshopId: string;
  part: Part;
  suppliers: Supplier[];
}) {
  const t = useT();
  const [supplierId, setSupplierId] = useState("");
  const [qty, setQty] = useState(Math.min(999, Math.max(1, part.qty)));
  const [price, setPrice] = useState<{ paise: number | null; text: string }>({ paise: null, text: "" });
  const priceOk = price.text.trim() === "" || price.paise !== null;

  return (
    <RpcDialog
      userId={userId}
      action={addDraftLine}
      values={() =>
        supplierId && priceOk
          ? {
              workshop_id: workshopId,
              supplier_id: supplierId,
              part_id: part.part_id,
              qty,
              unit_price_paise: price.text.trim() === "" ? null : price.paise,
            }
          : null
      }
      triggerLabel={t("purchasing.addToDraft")}
      triggerVariant="outline"
      triggerTestId={`add-to-draft-${part.sku}`}
      title={t("purchasing.addToDraftTitle", { sku: part.sku })}
      confirmLabel={t("purchasing.addToDraft")}
      onOpenChange={(open) => {
        if (!open) {
          setSupplierId("");
          setPrice({ paise: null, text: "" });
        }
      }}
    >
      <Field label={t("purchasing.supplier")}>
        {(id) => (
          <NativeSelect id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t("purchasing.chooseSupplier")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {t("purchasing.supplierOption", { name: s.name, city: s.city ?? "", days: s.lead_time_days })}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <QtyStepper label={t("purchasing.qty")} value={qty} onChange={setQty} uom={part.uom} />
      <MoneyInput
        label={t("purchasing.unitPriceOptional")}
        onChange={(paise, text) => setPrice({ paise, text })}
        invalid={!priceOk}
      />
    </RpcDialog>
  );
}
