"use client";

import { useState } from "react";
import { Field, inputClass, NativeSelect } from "@/components/forms/field";
import { MoneyInput } from "@/components/money-input";
import { PartPicker, type PartHit } from "@/components/part-picker";
import { QtyStepper } from "@/components/qty-stepper";
import { RpcButton, RpcDialog } from "@/components/rpc-dialog";
import { Input } from "@/components/ui/input";
import { ATTR_ENUM, ATTR_KEYS, ATTR_VALUES, type AttrKey } from "@/lib/catalogue";
import { Constants, type Database } from "@/lib/database.types";
import type { EnumName, MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import {
  addBin,
  saveFindingType,
  saveFitment,
  saveMapping,
  saveModel,
  savePart,
  saveSupplier,
  saveSupplierPrice,
  saveVariant,
  setActive,
} from "./actions";

type Enums = Database["public"]["Enums"];
type Tables = Database["public"]["Tables"];
const E = Constants.public.Enums;

const toInt = (s: string) => (/^\d{1,4}$/.test(s) ? Number(s) : Number.NaN);
const paiseText = (paise: number) => {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, "0")}`;
};

function TextField({
  label,
  value,
  onChange,
  inputMode,
  maxLength,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "numeric" | "text" | "tel";
  maxLength?: number;
  testId?: string;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          className={inputClass}
          value={value}
          inputMode={inputMode}
          maxLength={maxLength}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function EnumSelect<N extends EnumName>({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: N;
  value: Enums[N];
  onChange: (v: Enums[N]) => void;
}) {
  const t = useT();
  return (
    <Field label={label}>
      {(id) => (
        <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as Enums[N])}>
          {(E[name] as unknown as readonly Enums[N][]).map((v) => (
            <option key={v} value={v}>
              {t(`enums.${name}.${v}` as MessageKey)}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------

export function ActiveButton({
  userId,
  table,
  id,
  isActive,
}: {
  userId: string;
  table: "suppliers" | "parts" | "finding_types" | "bins";
  id: string;
  isActive: boolean;
}) {
  const t = useT();
  return (
    <RpcButton
      userId={userId}
      action={setActive}
      values={{ table, id, is_active: !isActive }}
      label={isActive ? t("catalogue.retire") : t("catalogue.restore")}
      variant="outline"
    />
  );
}

type Model = Pick<Tables["vehicle_models"]["Row"], "id" | "make" | "model" | "segment">;

export function ModelDialog({ userId, model }: { userId: string; model?: Model }) {
  const t = useT();
  const [make, setMake] = useState(model?.make ?? "");
  const [name, setName] = useState(model?.model ?? "");
  const [segment, setSegment] = useState<Enums["vehicle_segment"]>(model?.segment ?? "motorcycle");
  return (
    <RpcDialog
      userId={userId}
      action={saveModel}
      values={() => ({ id: model?.id ?? null, make, model: name, segment })}
      triggerLabel={model ? t("catalogue.edit") : t("catalogue.addModel")}
      title={model ? t("catalogue.editModel") : t("catalogue.addModel")}
      confirmLabel={t("catalogue.save")}
    >
      <TextField label={t("catalogue.make")} value={make} onChange={setMake} maxLength={40} />
      <TextField label={t("catalogue.modelName")} value={name} onChange={setName} maxLength={60} />
      <EnumSelect label={t("catalogue.segment")} name="vehicle_segment" value={segment} onChange={setSegment} />
    </RpcDialog>
  );
}

type Variant = Omit<Tables["model_variants"]["Row"], "created_at">;

export function VariantDialog({ userId, modelId, variant }: { userId: string; modelId: string; variant?: Variant }) {
  const t = useT();
  const [name, setName] = useState(variant?.name ?? "");
  const [from, setFrom] = useState(variant ? String(variant.year_from) : "");
  const [to, setTo] = useState(variant?.year_to ? String(variant.year_to) : "");
  const [brakeFront, setBrakeFront] = useState<Enums["brake_type"]>(variant?.brake_front ?? "drum");
  const [brakeRear, setBrakeRear] = useState<Enums["brake_type"]>(variant?.brake_rear ?? "drum");
  const [start, setStart] = useState<Enums["start_type"]>(variant?.start_type ?? "kick_self");
  const [wheels, setWheels] = useState<Enums["wheel_type"]>(variant?.wheels ?? "alloy");
  const [emission, setEmission] = useState<Enums["emission_norm"]>(variant?.emission ?? "bs6");
  const [fuel, setFuel] = useState<Enums["fuel_system"]>(variant?.fuel ?? "fi");
  return (
    <RpcDialog
      userId={userId}
      action={saveVariant}
      values={() => ({
        id: variant?.id ?? null,
        model_id: modelId,
        name,
        year_from: toInt(from),
        year_to: to.trim() ? toInt(to) : null,
        brake_front: brakeFront,
        brake_rear: brakeRear,
        start_type: start,
        wheels,
        emission,
        fuel,
      })}
      triggerLabel={variant ? t("catalogue.edit") : t("catalogue.addVariant")}
      title={variant ? t("catalogue.editVariant") : t("catalogue.addVariant")}
      confirmLabel={t("catalogue.save")}
    >
      <TextField label={t("catalogue.variantName")} value={name} onChange={setName} maxLength={80} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label={t("catalogue.yearFrom")} value={from} onChange={setFrom} inputMode="numeric" maxLength={4} />
        <TextField label={t("catalogue.yearTo")} value={to} onChange={setTo} inputMode="numeric" maxLength={4} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <EnumSelect label={t("catalogue.brakeFront")} name="brake_type" value={brakeFront} onChange={setBrakeFront} />
        <EnumSelect label={t("catalogue.brakeRear")} name="brake_type" value={brakeRear} onChange={setBrakeRear} />
        <EnumSelect label={t("catalogue.startType")} name="start_type" value={start} onChange={setStart} />
        <EnumSelect label={t("catalogue.wheels")} name="wheel_type" value={wheels} onChange={setWheels} />
        <EnumSelect label={t("catalogue.emission")} name="emission_norm" value={emission} onChange={setEmission} />
        <EnumSelect label={t("catalogue.fuel")} name="fuel_system" value={fuel} onChange={setFuel} />
      </div>
    </RpcDialog>
  );
}

type Part = Omit<Tables["parts"]["Row"], "created_at" | "oem_part_no_norm" | "is_active">;
type SupplierOption = { id: string; name: string; city: string };

export function PartDialog({ userId, part, suppliers }: { userId: string; part?: Part; suppliers: SupplierOption[] }) {
  const t = useT();
  const [sku, setSku] = useState(part?.sku ?? "");
  const [name, setName] = useState(part?.name ?? "");
  const [nameHi, setNameHi] = useState(part?.name_hi ?? "");
  const [aliases, setAliases] = useState(part?.aliases.join(", ") ?? "");
  const [oem, setOem] = useState(part?.oem_part_no ?? "");
  const [category, setCategory] = useState<Enums["part_category"]>(part?.category ?? "wear");
  const [partType, setPartType] = useState(part?.part_type ?? "");
  const [uom, setUom] = useState<Enums["uom"]>(part?.uom ?? "pcs");
  const [price, setPrice] = useState<number | null>(part?.standard_price_paise ?? null);
  const [supplier, setSupplier] = useState(part?.preferred_supplier_id ?? "");
  const [universal, setUniversal] = useState(part?.is_universal ?? false);
  return (
    <RpcDialog
      userId={userId}
      action={savePart}
      values={() =>
        price === null
          ? null
          : {
              id: part?.id ?? null,
              sku,
              name,
              name_hi: nameHi,
              aliases,
              oem_part_no: oem,
              category,
              part_type: partType,
              uom,
              standard_price_paise: price,
              preferred_supplier_id: supplier || null,
              is_universal: universal,
            }
      }
      triggerLabel={part ? t("catalogue.edit") : t("catalogue.addPart")}
      title={part ? t("catalogue.editPart") : t("catalogue.addPart")}
      confirmLabel={t("catalogue.save")}
    >
      <TextField label={t("catalogue.sku")} value={sku} onChange={setSku} maxLength={40} />
      <TextField label={t("catalogue.partName")} value={name} onChange={setName} maxLength={120} />
      <TextField label={t("catalogue.partNameHi")} value={nameHi} onChange={setNameHi} maxLength={120} />
      <TextField label={t("catalogue.aliases")} value={aliases} onChange={setAliases} maxLength={500} />
      <TextField label={t("catalogue.oemPartNo")} value={oem} onChange={setOem} maxLength={40} />
      <TextField label={t("catalogue.partType")} value={partType} onChange={setPartType} maxLength={60} />
      <div className="grid grid-cols-2 gap-2">
        <EnumSelect label={t("catalogue.category")} name="part_category" value={category} onChange={setCategory} />
        <EnumSelect label={t("catalogue.uom")} name="uom" value={uom} onChange={setUom} />
      </div>
      <MoneyInput
        label={`${t("catalogue.standardPrice")} (${t("common.inclGst")})`}
        defaultValue={part ? paiseText(part.standard_price_paise) : ""}
        onChange={(p) => setPrice(p)}
      />
      <Field label={t("catalogue.preferredSupplier")}>
        {(id) => (
          <NativeSelect id={id} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">{t("catalogue.none")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.city})
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" className="size-5" checked={universal} onChange={(e) => setUniversal(e.target.checked)} />
        {t("catalogue.universal")}
      </label>
    </RpcDialog>
  );
}

export function FitmentDialog({
  userId,
  variantId,
  workshopId,
  fitment,
}: {
  userId: string;
  variantId: string;
  workshopId: string;
  fitment?: { part_id: string; sku: string; uom: Enums["uom"]; qty_per_bike: number };
}) {
  const t = useT();
  const [part, setPart] = useState<PartHit | null>(null);
  const [qty, setQty] = useState(fitment?.qty_per_bike ?? 1);
  const partId = fitment?.part_id ?? part?.part_id;
  return (
    <RpcDialog
      userId={userId}
      action={saveFitment}
      values={() => (partId ? { part_id: partId, variant_id: variantId, qty_per_bike: qty, existing: Boolean(fitment) } : null)}
      triggerLabel={fitment ? t("catalogue.edit") : t("catalogue.addFitment")}
      title={fitment ? t("catalogue.editFitment", { sku: fitment.sku }) : t("catalogue.addFitment")}
      confirmLabel={t("catalogue.save")}
    >
      {!fitment && <PartPicker workshopId={workshopId} variantId={variantId} selectedId={part?.part_id} onPick={setPart} />}
      <QtyStepper
        label={t("catalogue.qtyPerBike")}
        value={qty}
        onChange={setQty}
        min={1}
        max={99}
        uom={fitment?.uom ?? part?.uom ?? "pcs"}
      />
    </RpcDialog>
  );
}

export function SupplierPriceDialog({
  userId,
  partId,
  suppliers,
  row,
}: {
  userId: string;
  partId: string;
  suppliers: SupplierOption[];
  row?: { supplier_id: string; supplier_code: string | null; price_paise: number };
}) {
  const t = useT();
  const [supplier, setSupplier] = useState(row?.supplier_id ?? "");
  const [code, setCode] = useState(row?.supplier_code ?? "");
  const [price, setPrice] = useState<number | null>(row?.price_paise ?? null);
  return (
    <RpcDialog
      userId={userId}
      action={saveSupplierPrice}
      values={() =>
        supplier && price !== null
          ? { supplier_id: supplier, part_id: partId, supplier_code: code, price_paise: price, existing: Boolean(row) }
          : null
      }
      triggerLabel={row ? t("catalogue.edit") : t("catalogue.addSupplierPrice")}
      title={row ? t("catalogue.editSupplierPrice") : t("catalogue.addSupplierPrice")}
      confirmLabel={t("catalogue.save")}
    >
      <Field label={t("catalogue.supplier")}>
        {(id) => (
          <NativeSelect id={id} value={supplier} disabled={Boolean(row)} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">{t("catalogue.chooseSupplier")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.city})
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <TextField label={t("catalogue.supplierCode")} value={code} onChange={setCode} maxLength={40} />
      <MoneyInput
        label={`${t("catalogue.price")} (${t("common.inclGst")})`}
        defaultValue={row ? paiseText(row.price_paise) : ""}
        onChange={(p) => setPrice(p)}
      />
    </RpcDialog>
  );
}

type FindingType = Pick<Tables["finding_types"]["Row"], "id" | "code" | "label_en" | "label_hi" | "area">;

export function FindingTypeDialog({ userId, findingType }: { userId: string; findingType?: FindingType }) {
  const t = useT();
  const [code, setCode] = useState(findingType?.code ?? "");
  const [labelEn, setLabelEn] = useState(findingType?.label_en ?? "");
  const [labelHi, setLabelHi] = useState(findingType?.label_hi ?? "");
  const [area, setArea] = useState<Enums["finding_area"]>(findingType?.area ?? "engine");
  return (
    <RpcDialog
      userId={userId}
      action={saveFindingType}
      values={() => ({ id: findingType?.id ?? null, code, label_en: labelEn, label_hi: labelHi, area })}
      triggerLabel={findingType ? t("catalogue.edit") : t("catalogue.addFindingType")}
      title={findingType ? t("catalogue.editFindingType") : t("catalogue.addFindingType")}
      confirmLabel={t("catalogue.save")}
    >
      {!findingType && <TextField label={t("catalogue.code")} value={code} onChange={setCode} maxLength={60} />}
      <TextField label={t("catalogue.labelEn")} value={labelEn} onChange={setLabelEn} maxLength={80} />
      <TextField label={t("catalogue.labelHi")} value={labelHi} onChange={setLabelHi} maxLength={80} />
      <EnumSelect label={t("catalogue.area")} name="finding_area" value={area} onChange={setArea} />
    </RpcDialog>
  );
}

type Mapping = Pick<Tables["finding_type_parts"]["Row"], "id" | "part_type" | "qty" | "attr_key" | "attr_value">;

export function MappingDialog({ userId, findingTypeId, mapping }: { userId: string; findingTypeId: string; mapping?: Mapping }) {
  const t = useT();
  const [partType, setPartType] = useState(mapping?.part_type ?? "");
  const [qty, setQty] = useState(mapping?.qty ?? 1);
  const [key, setKey] = useState<AttrKey | "">((mapping?.attr_key as AttrKey | null) ?? "");
  const [value, setValue] = useState(mapping?.attr_value ?? "");
  const options = key ? (ATTR_VALUES[key] as readonly string[]) : [];
  return (
    <RpcDialog
      userId={userId}
      action={saveMapping}
      values={() => ({
        id: mapping?.id ?? null,
        finding_type_id: findingTypeId,
        part_type: partType,
        qty,
        attr_key: key || null,
        attr_value: key ? value : null,
      })}
      triggerLabel={mapping ? t("catalogue.edit") : t("catalogue.addMapping")}
      title={mapping ? t("catalogue.editMapping") : t("catalogue.addMapping")}
      description={t("catalogue.mappingRule")}
      confirmLabel={t("catalogue.save")}
    >
      <TextField label={t("catalogue.partType")} value={partType} onChange={setPartType} maxLength={60} />
      <QtyStepper label={t("catalogue.qty")} value={qty} onChange={setQty} min={1} max={99} uom="pcs" />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("catalogue.attrKey")}>
          {(id) => (
            <NativeSelect
              id={id}
              value={key}
              onChange={(e) => {
                setKey(e.target.value as AttrKey | "");
                setValue("");
              }}
            >
              <option value="">{t("catalogue.anyBike")}</option>
              {ATTR_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`catalogue.attr.${k}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        {key && (
          <Field label={t("catalogue.attrValue")}>
            {(id) => (
              <NativeSelect id={id} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">–</option>
                {options.map((v) => (
                  <option key={v} value={v}>
                    {t(`enums.${ATTR_ENUM[key]}.${v}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
      </div>
    </RpcDialog>
  );
}

type Supplier = Pick<Tables["suppliers"]["Row"], "id" | "name" | "city" | "phone" | "kind" | "lead_time_days">;

export function SupplierDialog({ userId, supplier }: { userId: string; supplier?: Supplier }) {
  const t = useT();
  const [name, setName] = useState(supplier?.name ?? "");
  const [city, setCity] = useState(supplier?.city ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [kind, setKind] = useState<Enums["supplier_kind"]>(supplier?.kind ?? "wholesaler");
  const [lead, setLead] = useState(String(supplier?.lead_time_days ?? 2));
  return (
    <RpcDialog
      userId={userId}
      action={saveSupplier}
      values={() => ({ id: supplier?.id ?? null, name, city, phone, kind, lead_time_days: toInt(lead) })}
      triggerLabel={supplier ? t("catalogue.edit") : t("catalogue.addSupplier")}
      title={supplier ? t("catalogue.editSupplier") : t("catalogue.addSupplier")}
      confirmLabel={t("catalogue.save")}
    >
      <TextField label={t("catalogue.supplierName")} value={name} onChange={setName} maxLength={80} />
      <TextField label={t("catalogue.city")} value={city} onChange={setCity} maxLength={40} />
      <TextField label={t("catalogue.phone")} value={phone} onChange={setPhone} inputMode="tel" maxLength={20} />
      <EnumSelect label={t("catalogue.kind")} name="supplier_kind" value={kind} onChange={setKind} />
      <TextField label={t("catalogue.leadTime")} value={lead} onChange={setLead} inputMode="numeric" maxLength={2} />
    </RpcDialog>
  );
}

export function BinDialog({ userId, workshopId, workshopCode }: { userId: string; workshopId: string; workshopCode: string }) {
  const t = useT();
  const [code, setCode] = useState(`${workshopCode}-`);
  return (
    <RpcDialog
      userId={userId}
      action={addBin}
      values={() => ({ workshop_id: workshopId, code })}
      triggerLabel={t("catalogue.addBin")}
      title={t("catalogue.addBin")}
      description={t("catalogue.binCodeHelp", { ws: workshopCode })}
      confirmLabel={t("catalogue.save")}
      onOpenChange={(o) => !o && setCode(`${workshopCode}-`)}
    >
      <TextField label={t("catalogue.binCode")} value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={10} />
    </RpcDialog>
  );
}
