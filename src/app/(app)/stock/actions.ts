"use server";

import { z } from "zod";
import { rpcInput, runRpc } from "@/lib/rpc";
import type { RpcResult } from "@/lib/rpc-form-logic";
import { createClient } from "@/lib/supabase/server";

// Server actions for stock lookup, cycle counts and quarantine (SPEC §8.4).
const reason = z.string().trim().min(1, "validation.required").max(200, "validation.tooLong");
const qty1 = z.number().int("validation.integer").min(1, "validation.qtyRange").max(999, "validation.qtyRange");
const count = z.number().int("validation.integer").min(0, "validation.qtyRange").max(9999, "validation.qtyRange");

const binSchema = rpcInput({ bin_id: z.guid() });
export async function requestBinCount(input: z.input<typeof binSchema>) {
  return runRpc({
    route: "/stock",
    schema: binSchema,
    input,
    fn: "request_bin_count",
    toArgs: (d) => ({ p_bin_id: d.bin_id }),
  });
}

export type BikeRef = { card_code: string; reg_no: string | null };
export type AdjustResult = {
  delta: number;
  on_hand: number;
  /** Bikes whose reservation was released by a lower count (SPEC §6 dereserve_excess). */
  released_bikes: BikeRef[];
  allocated: { line_id: string; card_code: string; reg_no: string; qty: number }[];
};
export type StaleMove = {
  id: number;
  created_at: string;
  move_type: string;
  bin_delta: number | null;
  user_full_name: string | null;
};

const adjustSchema = rpcInput({
  workshop_id: z.guid(),
  bin_id: z.guid(),
  part_id: z.guid(),
  counted_qty: count,
  expected_on_hand: count,
  reason: z.enum(["count_correction", "lost", "found"]),
  /** When the count screen loaded: STALE_COUNT lists the moves since then. */
  loaded_at: z.iso.datetime({ offset: true }),
});

export async function adjustStock(input: z.input<typeof adjustSchema>): Promise<RpcResult<AdjustResult>> {
  const res = await runRpc({
    route: "/stock/count/[binId]",
    schema: adjustSchema,
    input,
    fn: "adjust_stock",
    toArgs: (d) => ({
      p_bin_id: d.bin_id,
      p_part_id: d.part_id,
      p_counted_qty: d.counted_qty,
      p_expected_on_hand: d.expected_on_hand,
      p_reason: d.reason,
    }),
  });
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return res as RpcResult<AdjustResult>;
  const supabase = await createClient();

  if (!res.ok) {
    if (res.code !== "STALE_COUNT") return res;
    // Who moved stock since the screen loaded (reads under RLS; the detail stays if this fails).
    const { data } = await supabase.rpc("stock_ledger", {
      p_workshop_id: parsed.data.workshop_id,
      p_part_id: parsed.data.part_id,
      p_bin_id: parsed.data.bin_id,
      p_limit: 10,
    });
    const all = data ?? [];
    const since = all.filter((m) => Date.parse(m.created_at) > Date.parse(parsed.data.loaded_at));
    // Clock skew between app and database: fall back to the latest moves.
    const moves: StaleMove[] = (since.length > 0 ? since : all.slice(0, 3)).map((m) => ({
      id: m.id,
      created_at: m.created_at,
      move_type: m.move_type,
      bin_delta: m.bin_delta,
      user_full_name: m.user_full_name,
    }));
    return { ...res, detail: { ...((res.detail as object | null) ?? {}), moves } };
  }

  const data = res.data as unknown as { delta: number; on_hand: number; released: string[]; allocated: AdjustResult["allocated"] };
  let released_bikes: BikeRef[] = data.released.map((code) => ({ card_code: code, reg_no: null }));
  if (data.released.length > 0) {
    const { data: cards } = await supabase.from("job_cards").select("code, bikes(reg_no)").in("code", data.released);
    const reg = new Map((cards ?? []).map((c) => [c.code, (c.bikes as { reg_no: string } | null)?.reg_no ?? null]));
    released_bikes = data.released.map((code) => ({ card_code: code, reg_no: reg.get(code) ?? null }));
  }
  return { ok: true, data: { delta: data.delta, on_hand: data.on_hand, released_bikes, allocated: data.allocated } };
}

const moveSchema = rpcInput({ part_id: z.guid(), from_bin_id: z.guid(), to_bin_id: z.guid(), qty: qty1, reason });
export async function moveStock(input: z.input<typeof moveSchema>) {
  return runRpc({
    route: "/stock/quarantine",
    schema: moveSchema,
    input,
    fn: "move_stock",
    toArgs: (d) => ({ p_part_id: d.part_id, p_from_bin_id: d.from_bin_id, p_to_bin_id: d.to_bin_id, p_qty: d.qty, p_reason: d.reason }),
  });
}

const rtsSchema = rpcInput({ bin_id: z.guid(), part_id: z.guid(), qty: qty1, reason });
export async function returnToSupplier(input: z.input<typeof rtsSchema>) {
  return runRpc({
    route: "/stock/quarantine",
    schema: rtsSchema,
    input,
    fn: "return_to_supplier",
    toArgs: (d) => ({ p_bin_id: d.bin_id, p_part_id: d.part_id, p_qty: d.qty, p_reason: d.reason }),
  });
}
