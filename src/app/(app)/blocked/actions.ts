"use server";

import { z } from "zod";
import { rpcInput, runRpc } from "@/lib/rpc";

const generateSchema = rpcInput({ workshop_id: z.guid() });

export type GenerateResult = {
  added: number;
  changed: number;
  removed: number;
  unsourced: { part_id: string; sku: string; name: string; qty: number }[];
};

/** generate_draft_pos (SPEC §7.1) for the board's workshop. */
export async function generatePos(input: z.input<typeof generateSchema>) {
  return runRpc({
    route: "/blocked",
    schema: generateSchema,
    input,
    fn: "generate_draft_pos",
    toArgs: (d) => ({ p_workshop_id: d.workshop_id }),
  });
}
