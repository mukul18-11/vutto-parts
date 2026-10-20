"use server";

import { z } from "zod";
import { rpcInput, runRpc } from "@/lib/rpc";

// Server actions for the purchasing screens (SPEC §7.2–§7.5): one RPC each. Prices are integer
// paise incl. GST (SPEC §13); reasons 1–200 chars.
const ROUTE = "/purchasing";
const reason = z.string().trim().min(1, "validation.required").max(200, "validation.tooLong");
const qty = z.number().int("validation.integer").min(1, "validation.qtyRange").max(999, "validation.qtyRange");
const paise = z.number().int("validation.money").positive("validation.money").max(999_999_999, "validation.money");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.invalid");

const addSchema = rpcInput({
  workshop_id: z.guid(),
  supplier_id: z.guid(),
  part_id: z.guid(),
  qty,
  unit_price_paise: paise.nullable(),
});
export async function addDraftLine(input: z.input<typeof addSchema>) {
  return runRpc({
    route: ROUTE,
    schema: addSchema,
    input,
    fn: "add_draft_line",
    toArgs: (d) => ({
      p_workshop_id: d.workshop_id,
      p_supplier_id: d.supplier_id,
      p_part_id: d.part_id,
      p_qty: d.qty,
      ...(d.unit_price_paise !== null ? { p_unit_price_paise: d.unit_price_paise } : {}),
    }),
  });
}

const updateSchema = rpcInput({ line_id: z.guid(), qty, unit_price_paise: paise.nullable() });
export async function updateDraftLine(input: z.input<typeof updateSchema>) {
  return runRpc({
    route: ROUTE,
    schema: updateSchema,
    input,
    fn: "update_draft_line",
    toArgs: (d) => ({
      p_line_id: d.line_id,
      p_qty: d.qty,
      // The generated type marks it required; null clears the price (send then refuses).
      p_unit_price_paise: d.unit_price_paise as number,
    }),
  });
}

const removeSchema = rpcInput({ line_id: z.guid() });
export async function removeDraftLine(input: z.input<typeof removeSchema>) {
  return runRpc({
    route: ROUTE,
    schema: removeSchema,
    input,
    fn: "remove_draft_line",
    toArgs: (d) => ({ p_line_id: d.line_id }),
  });
}

export type SendResult = { po: { po_id: string; code: string; expected_on: string }; whatsapp_text: string };

const poSchema = rpcInput({ po_id: z.guid() });
export async function sendPo(input: z.input<typeof poSchema>) {
  return runRpc({ route: ROUTE, schema: poSchema, input, fn: "send_po", toArgs: (d) => ({ p_po_id: d.po_id }) });
}

const expectedSchema = rpcInput({ po_id: z.guid(), date: isoDate });
export async function setPoExpectedOn(input: z.input<typeof expectedSchema>) {
  return runRpc({
    route: ROUTE,
    schema: expectedSchema,
    input,
    fn: "set_po_expected_on",
    toArgs: (d) => ({ p_po_id: d.po_id, p_date: d.date }),
  });
}

const shortCloseSchema = rpcInput({ po_id: z.guid(), line_ids: z.array(z.guid()).min(1).nullable(), reason });
export async function shortClosePo(input: z.input<typeof shortCloseSchema>) {
  return runRpc({
    route: ROUTE,
    schema: shortCloseSchema,
    input,
    fn: "short_close_po",
    toArgs: (d) => ({ p_po_id: d.po_id, p_line_ids: d.line_ids as string[], p_reason: d.reason }),
  });
}

const cancelSchema = rpcInput({ po_id: z.guid(), reason });
export async function cancelPo(input: z.input<typeof cancelSchema>) {
  return runRpc({
    route: ROUTE,
    schema: cancelSchema,
    input,
    fn: "cancel_po",
    toArgs: (d) => ({ p_po_id: d.po_id, p_reason: d.reason }),
  });
}
