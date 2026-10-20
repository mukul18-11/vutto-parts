"use server";

import { z } from "zod";
import { rpcInput, runRpc } from "@/lib/rpc";
import type { RpcResult } from "@/lib/rpc-form-logic";
import { createClient } from "@/lib/supabase/server";

// Server actions for the store keeper's receiving and putaway screens (SPEC §7.4, §3.4).
const qty0 = z.number().int("validation.integer").min(0, "validation.qtyRange").max(999, "validation.qtyRange");
const qty1 = z.number().int("validation.integer").min(1, "validation.qtyRange").max(999, "validation.qtyRange");
const paise = z.number().int("validation.money").positive("validation.money").max(999_999_999, "validation.money");

const grnLine = z.object({
  po_line_id: z.guid(),
  qty_received: qty1,
  qty_damaged: qty0,
  qty_wrong_part: qty0,
  unit_price_paise: paise,
});
const receiveSchema = rpcInput({
  po_id: z.guid(),
  supplier_invoice_no: z.string().trim().min(1, "validation.required").max(40, "validation.tooLong"),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.required"),
  allow_duplicate_invoice: z.boolean(),
  lines: z.array(grnLine).min(1, "validation.required").max(200),
});

export type GrnAllocation = {
  reg_no: string;
  card_code: string;
  line_id: string;
  part_id: string;
  part: string;
  part_name: string;
  qty: number;
  waiting_since: string | null;
};
export type GrnResult = {
  grn: {
    grn_id: string;
    code: string;
    po_code: string;
    po_status: string;
    lines: { po_line_id: string; sku: string; qty_received: number; qty_accepted: number; qty_damaged: number; qty_wrong_part: number }[];
  };
  allocations: GrnAllocation[];
  /** Card code → job card id, for the "Issue now" links (looked up after the RPC). */
  card_ids: Record<string, string>;
};

export async function receiveGrn(input: z.input<typeof receiveSchema>): Promise<RpcResult<GrnResult>> {
  const res = await runRpc({
    route: "/store/receive/[poId]",
    schema: receiveSchema,
    input,
    fn: "receive_grn",
    toArgs: (d) => ({
      p_po_id: d.po_id,
      p_supplier_invoice_no: d.supplier_invoice_no,
      p_invoice_date: d.invoice_date,
      p_allow_duplicate_invoice: d.allow_duplicate_invoice,
      p_lines: d.lines,
    }),
  });
  if (!res.ok) return res;
  const data = res.data as unknown as Omit<GrnResult, "card_ids">;
  const codes = [...new Set(data.allocations.map((a) => a.card_code))];
  const card_ids: Record<string, string> = {};
  if (codes.length > 0) {
    // Read only; a failure here just leaves the links out.
    const supabase = await createClient();
    const { data: cards } = await supabase.from("job_cards").select("id, code").in("code", codes);
    for (const c of cards ?? []) card_ids[c.code] = c.id;
  }
  return { ok: true, data: { ...data, card_ids } };
}

const putawaySchema = rpcInput({ part_id: z.guid(), from_bin_id: z.guid(), to_bin_id: z.guid(), qty: qty1 });
export type PutawayResult = { qty: number; from_on_hand: number; to_on_hand: number };

export async function putaway(input: z.input<typeof putawaySchema>) {
  return runRpc({
    route: "/store/putaway",
    schema: putawaySchema,
    input,
    fn: "putaway",
    toArgs: (d) => ({ p_part_id: d.part_id, p_from_bin_id: d.from_bin_id, p_to_bin_id: d.to_bin_id, p_qty: d.qty }),
  });
}

// ---------------------------------------------------------------------------------------------
// Issue, returns, emergency buys, extra parts and compensating moves (SPEC §8, §5.2, §14).

/** private.line_payload: a line's state after the call. */
export type LinePayload = {
  line_id: string;
  card_id: string;
  card_code: string;
  part_id: string;
  sku: string;
  qty_required: number;
  qty_reserved: number;
  qty_issued: number;
  qty_returned: number;
  net_issued: number;
  status: string;
  cancelled_at: string | null;
};
export type Allocation = { line_id: string; card_code: string; reg_no: string; qty: number };

const issueSchema = rpcInput({ line_id: z.guid(), bin_id: z.guid(), qty: qty1 });
export type IssueResult = {
  line: LinePayload;
  reg_no: string;
  qty: number;
  move_id: number;
  bin_id: string;
  bin_code: string;
  bin_on_hand: number;
  allocated: Allocation[];
};

export async function issueToJobCard(input: z.input<typeof issueSchema>): Promise<RpcResult<IssueResult>> {
  const res = await runRpc({
    route: "/store/issue/[cardId]",
    schema: issueSchema,
    input,
    fn: "issue_to_job_card",
    toArgs: (d) => ({ p_line_id: d.line_id, p_bin_id: d.bin_id, p_qty: d.qty }),
  });
  return res.ok ? { ok: true, data: res.data as unknown as IssueResult } : res;
}

const returnSchema = rpcInput({
  line_id: z.guid(),
  qty: qty1,
  reason: z.enum(["not_needed", "issued_by_mistake", "damaged", "wrong_fitment"]),
  to_bin_id: z.guid().nullable(),
  note: z.string().trim().max(500, "validation.tooLong").nullable(),
});
export type ReturnResult = {
  line: LinePayload;
  reason: string;
  qty: number;
  move_id: number;
  bin_id: string;
  bin_code: string;
  bin_on_hand: number;
  allocated: Allocation[];
};

export async function returnFromJobCard(input: z.input<typeof returnSchema>): Promise<RpcResult<ReturnResult>> {
  const res = await runRpc({
    route: "/store/return/[cardId]",
    schema: returnSchema,
    input,
    fn: "return_from_job_card",
    toArgs: (d) => ({
      p_line_id: d.line_id,
      p_qty: d.qty,
      p_reason: d.reason,
      ...(d.reason !== "damaged" && d.to_bin_id ? { p_to_bin_id: d.to_bin_id } : {}),
      ...(d.note ? { p_note: d.note } : {}),
    }),
  });
  return res.ok ? { ok: true, data: res.data as unknown as ReturnResult } : res;
}

const emergencySchema = rpcInput({
  line_id: z.guid(),
  qty: z.number().int("validation.integer").min(1, "validation.qtyRange").max(50, "validation.qtyRange"),
  unit_price_paise: z.number().int("validation.money").positive("validation.money").max(10_000_000, "validation.money"),
  vendor_name: z.string().trim().min(1, "validation.required").max(100, "validation.tooLong"),
  reason: z.enum(["no_stock", "supplier_late", "wrong_part_received", "other"]),
  note: z.string().trim().max(500, "validation.tooLong").nullable(),
});
export type EmergencyResult = {
  buy_id: string;
  qty: number;
  issued: number;
  qty_to_stock: number;
  warning: "JOB_CARD_NOT_CONFIRMED" | "LINE_CANCELLED" | "BIKE_NOT_ARRIVED" | null;
  unit_price_paise: number;
  reference_price_paise: number | null;
  premium: number | null;
  line: LinePayload;
  card_code: string;
  reg_no: string;
  receiving_bin_id: string;
  receiving_on_hand: number;
  allocated: Allocation[];
};

// Bill photos are out of scope (no bucket), so no p_bill_photo_path is ever sent.
export async function recordEmergencyBuy(input: z.input<typeof emergencySchema>): Promise<RpcResult<EmergencyResult>> {
  const res = await runRpc({
    route: "/store/emergency/[lineId]",
    schema: emergencySchema,
    input,
    fn: "record_emergency_buy",
    toArgs: (d) => ({
      p_line_id: d.line_id,
      p_qty: d.qty,
      p_unit_price_paise: d.unit_price_paise,
      p_vendor_name: d.vendor_name,
      p_reason: d.reason,
      ...(d.note ? { p_note: d.note } : {}),
    }),
  });
  return res.ok ? { ok: true, data: res.data as unknown as EmergencyResult } : res;
}

// A store keeper's extra part always carries a reason (SPEC §2, §5.2: source extra).
const extraSchema = rpcInput({
  card_id: z.guid(),
  part_id: z.guid(),
  qty: qty1,
  reason: z.string().trim().min(1, "validation.required").max(200, "validation.tooLong"),
});
export async function addExtraPart(input: z.input<typeof extraSchema>) {
  return runRpc({
    route: "/store/issue/[cardId]",
    schema: extraSchema,
    input,
    fn: "add_job_card_line",
    toArgs: (d) => ({ p_card_id: d.card_id, p_part_id: d.part_id, p_qty: d.qty, p_reason: d.reason }),
  });
}

// Compensating "Move to another bin" (SPEC §14 undo). A normal → normal move needs no reason;
// move_stock treats an empty reason as none.
const moveSchema = rpcInput({
  part_id: z.guid(),
  from_bin_id: z.guid(),
  to_bin_id: z.guid(),
  qty: qty1,
  reason: z.string().trim().max(200, "validation.tooLong"),
});
export type MoveResult = { qty: number; from_on_hand: number; to_on_hand: number };
export async function moveStockFromStore(input: z.input<typeof moveSchema>) {
  return runRpc({
    route: "/store",
    schema: moveSchema,
    input,
    fn: "move_stock",
    toArgs: (d) => ({ p_part_id: d.part_id, p_from_bin_id: d.from_bin_id, p_to_bin_id: d.to_bin_id, p_qty: d.qty, p_reason: d.reason }),
  });
}
