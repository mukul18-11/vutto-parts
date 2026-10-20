"use server";

import { z } from "zod";
import { ATTR_KEYS } from "@/lib/catalogue";
import { Constants } from "@/lib/database.types";
import { runTableWrite } from "@/lib/master-write";
import { rpcInput } from "@/lib/rpc";
import { parseAliases } from "@/lib/search-term";

// Master data edits (SPEC §3.1, §11.2): admin only, one direct insert or update per action under
// RLS. Nothing is deleted; rows are retired with is_active. Bin code and kind never change.
const ROUTE = "/catalogue";
const E = Constants.public.Enums;
const text = (max: number) => z.string().trim().min(1, "validation.required").max(max, "validation.tooLong");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "validation.tooLong")
    .nullable()
    .transform((v) => v || null);
const year = z.number().int("validation.integer").min(1950, "validation.invalid").max(2100, "validation.invalid");
const qty = z.number().int("validation.integer").min(1, "validation.qtyRange").max(999, "validation.qtyRange");
const paise = z.number().int("validation.money").positive("validation.money").max(9_999_999_99, "validation.money");
const id = z.guid().nullable();

const modelSchema = rpcInput({ id, make: text(40), model: text(60), segment: z.enum(E.vehicle_segment) });
export async function saveModel(input: z.input<typeof modelSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: modelSchema,
    input,
    write: (sb, { id, make, model, segment }) =>
      id
        ? sb.from("vehicle_models").update({ make, model, segment }).eq("id", id)
        : sb.from("vehicle_models").insert({ make, model, segment }),
  });
}

const variantSchema = rpcInput({
  id,
  model_id: z.guid(),
  name: text(80),
  year_from: year,
  year_to: year.nullable(),
  brake_front: z.enum(E.brake_type),
  brake_rear: z.enum(E.brake_type),
  start_type: z.enum(E.start_type),
  wheels: z.enum(E.wheel_type),
  emission: z.enum(E.emission_norm),
  fuel: z.enum(E.fuel_system),
});
export async function saveVariant(input: z.input<typeof variantSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: variantSchema,
    input,
    write: (sb, d) => {
      const row = {
        model_id: d.model_id,
        name: d.name,
        year_from: d.year_from,
        year_to: d.year_to,
        brake_front: d.brake_front,
        brake_rear: d.brake_rear,
        start_type: d.start_type,
        wheels: d.wheels,
        emission: d.emission,
        fuel: d.fuel,
      };
      return d.id ? sb.from("model_variants").update(row).eq("id", d.id) : sb.from("model_variants").insert(row);
    },
  });
}

const partSchema = rpcInput({
  id,
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, "validation.invalid"),
  name: z
    .string()
    .trim()
    .min(1, "validation.required")
    .max(120, "validation.tooLong")
    .regex(/^[\x20-\x7E]+$/, "validation.invalid"),
  name_hi: optText(120),
  aliases: z.string().max(500, "validation.tooLong"),
  oem_part_no: optText(40),
  category: z.enum(E.part_category),
  part_type: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,59}$/, "validation.invalid"),
  uom: z.enum(E.uom),
  standard_price_paise: paise,
  preferred_supplier_id: z.guid().nullable(),
  is_universal: z.boolean(),
});
export async function savePart(input: z.input<typeof partSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: partSchema,
    input,
    write: (sb, d) => {
      const values = {
        sku: d.sku,
        name: d.name,
        name_hi: d.name_hi,
        aliases: parseAliases(d.aliases),
        oem_part_no: d.oem_part_no,
        category: d.category,
        part_type: d.part_type,
        uom: d.uom,
        standard_price_paise: d.standard_price_paise,
        preferred_supplier_id: d.preferred_supplier_id,
        is_universal: d.is_universal,
      };
      return d.id ? sb.from("parts").update(values).eq("id", d.id) : sb.from("parts").insert(values);
    },
  });
}

const activeSchema = rpcInput({
  table: z.enum(["suppliers", "parts", "finding_types", "bins"]),
  id: z.guid(),
  is_active: z.boolean(),
});
/** Retire or restore a master row (never deleted, SPEC §3.1). */
export async function setActive(input: z.input<typeof activeSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: activeSchema,
    input,
    write: (sb, { table, id, is_active }) => sb.from(table).update({ is_active }).eq("id", id),
  });
}

const fitmentSchema = rpcInput({ part_id: z.guid(), variant_id: z.guid(), qty_per_bike: qty, existing: z.boolean() });
/** A catalogue fitment; counts and source of existing rows are never edited here. */
export async function saveFitment(input: z.input<typeof fitmentSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: fitmentSchema,
    input,
    write: (sb, { part_id, variant_id, qty_per_bike, existing }) =>
      existing
        ? sb.from("part_fitments").update({ qty_per_bike }).eq("part_id", part_id).eq("variant_id", variant_id)
        : sb.from("part_fitments").insert({ part_id, variant_id, qty_per_bike, source: "catalogue" }),
  });
}

const supplierPriceSchema = rpcInput({
  supplier_id: z.guid(),
  part_id: z.guid(),
  supplier_code: optText(40),
  price_paise: paise,
  existing: z.boolean(),
});
export async function saveSupplierPrice(input: z.input<typeof supplierPriceSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: supplierPriceSchema,
    input,
    write: (sb, { supplier_id, part_id, supplier_code, price_paise, existing }) =>
      existing
        ? sb
            .from("supplier_parts")
            .update({ supplier_code, price_paise })
            .eq("supplier_id", supplier_id)
            .eq("part_id", part_id)
        : sb.from("supplier_parts").insert({ supplier_id, part_id, supplier_code, price_paise }),
  });
}

const findingTypeSchema = rpcInput({
  id,
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,59}$/, "validation.invalid"),
  label_en: text(80),
  label_hi: text(80),
  area: z.enum(E.finding_area),
});
export async function saveFindingType(input: z.input<typeof findingTypeSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: findingTypeSchema,
    input,
    write: (sb, { id, code, label_en, label_hi, area }) =>
      id
        ? sb.from("finding_types").update({ label_en, label_hi, area }).eq("id", id)
        : sb.from("finding_types").insert({ code, label_en, label_hi, area }),
  });
}

const mappingSchema = rpcInput({
  id,
  finding_type_id: z.guid(),
  part_type: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,59}$/, "validation.invalid"),
  qty,
  attr_key: z.enum(ATTR_KEYS).nullable(),
  attr_value: optText(40),
});
/** finding_type_parts; the trigger refuses ambiguous mappings (SPEC §3.1). */
export async function saveMapping(input: z.input<typeof mappingSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: mappingSchema.refine((d) => (d.attr_key === null) === (d.attr_value === null), {
      message: "validation.required",
      path: ["attr_value"],
    }),
    input,
    write: (sb, { id, finding_type_id, part_type, qty, attr_key, attr_value }) =>
      id
        ? sb.from("finding_type_parts").update({ part_type, qty, attr_key, attr_value }).eq("id", id)
        : sb.from("finding_type_parts").insert({ finding_type_id, part_type, qty, attr_key, attr_value }),
  });
}

const supplierSchema = rpcInput({
  id,
  name: text(80),
  city: text(40),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 -]{6,20}$/, "validation.invalid"),
  kind: z.enum(E.supplier_kind),
  lead_time_days: z.number().int("validation.integer").min(0, "validation.invalid").max(30, "validation.invalid"),
});
export async function saveSupplier(input: z.input<typeof supplierSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: supplierSchema,
    input,
    write: (sb, d) => {
      const row = { name: d.name, city: d.city, phone: d.phone, kind: d.kind, lead_time_days: d.lead_time_days };
      return d.id ? sb.from("suppliers").update(row).eq("id", d.id) : sb.from("suppliers").insert(row);
    },
  });
}

const binSchema = rpcInput({
  workshop_id: z.guid(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^(NCR|JPR)-([A-Z][0-9]{2}-[0-9]{2}|RCV|QRN)$/, "catalogue.binCodeFormat"),
});
/** New bin; kind follows the code (RCV receiving, QRN quarantine, else normal; the trigger checks). */
export async function addBin(input: z.input<typeof binSchema>) {
  return runTableWrite({
    route: ROUTE,
    schema: binSchema,
    input,
    write: (sb, { workshop_id, code }) =>
      sb.from("bins").insert({
        workshop_id,
        code,
        kind: code.endsWith("-RCV") ? "receiving" : code.endsWith("-QRN") ? "quarantine" : "normal",
      }),
  });
}
