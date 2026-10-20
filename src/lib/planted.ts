// Planted demo scenarios (SPEC §15): codes written by pnpm seed:gen to scripts/seed/planted.json,
// which the admin page reads from there (never hard-coded). This is the only module in src/ that
// touches scripts/: a static JSON import (data, no script code), bundled at build time and
// validated here.
import { z } from "zod";
import raw from "../../scripts/seed/planted.json";

const codes = z.array(z.string());

const plantedWorkshop = z.object({
  chains: z.array(
    z.object({
      label: z.enum(["A", "B", "C"]),
      card_code: z.string(),
      reg_no: z.string(),
      po_code: z.string(),
      sku: z.string(),
      qty: z.number().int(),
      expected_on: z.string(),
    }),
  ),
  po_due_tomorrow: z.string(),
  po_overdue: z.string(),
  po_partially_received: z.string(),
  receiving: z.object({ sku: z.string(), qty: z.number().int(), reserved_for: codes }),
  ready_to_issue: codes,
  blocked: z.object({ in_transit: codes, overdue_po: codes, not_ordered: codes, flagged_fitment: codes }),
  inbound_shortfall: codes,
  low_stock_auto_skus: codes,
  dead_stock_skus: codes,
  emergency_buy_cards: codes,
  unsourced: z.object({ sku: z.string(), card_code: z.string() }),
  unknown_variant: z.object({ card_code: z.string(), reg_no: z.string() }),
  flagged_fitment: z.object({ sku: z.string(), variant: z.string(), card_code: z.string() }).nullable(),
});

export const plantedSchema = z.object({
  template_anchor_date: z.string(),
  NCR: plantedWorkshop,
  JPR: plantedWorkshop,
});

export type PlantedWorkshop = z.infer<typeof plantedWorkshop>;

export const planted = plantedSchema.parse(raw);
