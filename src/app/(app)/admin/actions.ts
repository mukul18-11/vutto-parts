"use server";

import { z } from "zod";
import { rpcBase, runExemptRpc } from "@/lib/rpc";

// Demo reset (SPEC §15, admin). The typed confirmation is checked again here; reset_demo() itself
// enforces admin, the try-lock (RESET_IN_PROGRESS) and the cooldown (RESET_COOLDOWN).
const resetSchema = rpcBase.extend({ confirm: z.literal("RESET", "validation.invalid") });

export async function resetDemo(input: z.input<typeof resetSchema>) {
  return runExemptRpc({ route: "/admin", schema: resetSchema, input, fn: "reset_demo" });
}
