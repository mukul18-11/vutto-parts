"use server";

import { z } from "zod";
import { rpcInput, runRpc } from "@/lib/rpc";

const findingSchema = z.object({
  finding_type_id: z.guid(),
  qty: z.number().int("validation.integer").min(1, "validation.qtyRange").max(999, "validation.qtyRange").nullable(),
  notes: z.string().trim().max(500, "validation.tooLong").nullable(),
});

const createBikeSchema = rpcInput({
  workshop_id: z.guid(),
  reg_no: z.string().trim().min(1, "validation.required").max(20, "validation.tooLong"),
  model_id: z.guid("validation.required"),
  variant_id: z.guid().nullable(),
  mfg_year: z.number("validation.integer").int("validation.integer").min(1995, "validation.invalid").max(2100, "validation.invalid"),
  findings: z.array(findingSchema).max(60),
});

export type CreateBikeInput = z.input<typeof createBikeSchema>;

/** create_bike (SPEC §5.2): bike, findings and a draft job card with suggested lines. */
export async function createBike(input: CreateBikeInput) {
  return runRpc({
    route: "/bikes/new",
    schema: createBikeSchema,
    input,
    fn: "create_bike",
    toArgs: (d) => ({
      p_workshop_id: d.workshop_id,
      p_reg_no: d.reg_no,
      p_model_id: d.model_id,
      p_mfg_year: d.mfg_year,
      p_findings: d.findings.map((f) => ({ finding_type_id: f.finding_type_id, qty: f.qty, notes: f.notes || null })),
      ...(d.variant_id ? { p_variant_id: d.variant_id } : {}),
    }),
  });
}
