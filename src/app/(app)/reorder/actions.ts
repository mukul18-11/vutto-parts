"use server";

import { z } from "zod";
import { runTableWrite } from "@/lib/master-write";
import { rpcInput } from "@/lib/rpc";

// Reorder settings (SPEC §3.1, §11.2): a master data table edited directly under RLS by admin or
// the manager of that workshop. One upsert per save; rows are never deleted.
const count = (min: number) =>
  z.number().int("validation.integer").min(min, "validation.qtyRange").max(9999, "validation.qtyRange");

const settingsSchema = rpcInput({
  workshop_id: z.guid(),
  part_id: z.guid(),
  auto: z.boolean(),
  safety_stock: count(0),
  max_qty: count(1),
  preferred_supplier_id: z.guid().nullable(),
});

export async function saveReorderSettings(input: z.input<typeof settingsSchema>) {
  return runTableWrite({
    route: "/reorder",
    schema: settingsSchema,
    input,
    allow: (profile, d) =>
      profile.role === "admin" || (profile.role === "manager" && profile.workshop_id === d.workshop_id),
    write: (sb, d) =>
      sb.from("reorder_settings").upsert(
        {
          workshop_id: d.workshop_id,
          part_id: d.part_id,
          auto: d.auto,
          safety_stock: d.safety_stock,
          max_qty: d.max_qty,
          preferred_supplier_id: d.preferred_supplier_id,
        },
        { onConflict: "workshop_id,part_id" },
      ),
  });
}
