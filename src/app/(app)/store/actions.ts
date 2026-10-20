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
