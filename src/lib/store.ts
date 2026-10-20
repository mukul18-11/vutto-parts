// Pure helpers for the store counter screens (SPEC §8, §9.2, §14): the card search, the issue
// quantity cap, the fit-badge second tap, the emergency buy premium and quantity cap, and the
// sentence a return's success screen states. No stock number is computed here; every quantity
// comes from the database (RPC results or views).

import type { MessageKey, TranslateVars } from "@/lib/i18n";

/**
 * Store card finder (SPEC §14): "1234" finds DL3SAB1234 and HR26CD1234 (reg-no suffix) and also
 * JC-NCR-001234 (a digits-only term matches the card number suffix); "jc ncr 2368" or
 * "JC-NCR-002368" finds that card (code_norm LIKE 'JCNCR%2368'). Everything is reduced to A–Z0–9
 * so the term is safe inside a PostgREST filter.
 */
export type StoreSearch =
  | { kind: "card"; pattern: string }
  | { kind: "reg"; suffix: string; alsoCode: boolean }
  | null;

export function parseStoreSearch(input: string | undefined | null): StoreSearch {
  const norm = (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  if (norm.length === 0) return null;
  const card = /^JC(NCR|JPR)?0*(\d+)$/.exec(norm);
  if (card) return { kind: "card", pattern: `JC${card[1] ?? ""}%${card[2]}` };
  return { kind: "reg", suffix: norm, alsoCode: /^\d+$/.test(norm) };
}

/** Most units one issue tap may take: the line's reservation and what the bin holds. */
export function issueMax(reserved: number, binOnHand: number | null): number {
  const cap = binOnHand === null ? reserved : Math.min(reserved, binOnHand);
  return Math.max(0, Math.min(999, cap));
}

export type FitLevel = "green" | "amber" | "red";

/** SPEC §9.2: amber and red need a second tap before issuing; green issues on the first. */
export function needsSecondTap(badge: FitLevel | null | undefined): boolean {
  return badge === "amber" || badge === "red";
}

/** Premium of a buy over the reference price in whole percent, or null without a reference. */
export function premiumPercent(unitPaise: number, referencePaise: number | null): number | null {
  if (!referencePaise || referencePaise <= 0) return null;
  return Math.round(((unitPaise - referencePaise) * 100) / referencePaise);
}

/** Above 25% over the reference is shown red (integer comparison, no float on money). */
export function isHighPremium(unitPaise: number, referencePaise: number | null): boolean {
  if (!referencePaise || referencePaise <= 0) return false;
  return unitPaise * 100 > referencePaise * 125;
}

/** Emergency buy quantity cap: the remaining need (at least 1), or the RPC's 50 once overridden. */
export const EMERGENCY_MAX_QTY = 50;
export function emergencyQtyCap(remainingNeed: number, override: boolean): number {
  if (override) return EMERGENCY_MAX_QTY;
  return Math.min(EMERGENCY_MAX_QTY, Math.max(1, remainingNeed));
}

/** Units of an emergency buy that go straight to the bike (mirrors record_emergency_buy's n). */
export function emergencyIssued(qty: number, remainingNeed: number, cardOk: boolean): number {
  return cardOk ? Math.max(0, Math.min(qty, remainingNeed)) : 0;
}

export const RETURN_REASONS = ["not_needed", "issued_by_mistake", "damaged", "wrong_fitment"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export function isReturnReason(value: unknown): value is ReturnReason {
  return typeof value === "string" && (RETURN_REASONS as readonly string[]).includes(value);
}

/** The return reason's rules (SPEC §8.2): damaged goes to quarantine; wrong fit needs a note. */
export function returnNeedsBin(reason: ReturnReason): boolean {
  return reason !== "damaged";
}
export const WRONG_FIT_NOTE_MIN = 5;
export function returnNoteOk(reason: ReturnReason, note: string): boolean {
  const n = note.trim().length;
  if (n > 500) return false;
  return reason === "wrong_fitment" ? n >= WRONG_FIT_NOTE_MIN : true;
}

export type Sentence = { key: MessageKey; vars?: TranslateVars };

/**
 * What a return did, for its success screen (SPEC §8.2). again = units the RPC reserved again for
 * this line (from its allocated list); others = units it reserved for other bikes.
 */
export function returnEffects(
  reason: ReturnReason,
  { qty, uom, bin, again, others, sku }: { qty: number; uom: string; bin: string; again: number; others: number; sku: string },
): Sentence[] {
  const out: Sentence[] = [];
  if (reason === "damaged") out.push({ key: "returns.effect.quarantined", vars: { qty, uom, sku, bin } });
  else out.push({ key: "returns.effect.toBin", vars: { qty, uom, sku, bin } });
  if (reason === "issued_by_mistake" || reason === "damaged") {
    out.push(
      again > 0
        ? { key: "returns.effect.reopenedReserved", vars: { n: again, uom } }
        : { key: "returns.effect.reopenedWaiting" },
    );
  }
  if (reason === "not_needed") out.push({ key: "returns.effect.needLowered", vars: { qty, uom } });
  if (reason === "wrong_fitment") out.push({ key: "returns.effect.wrongFit" });
  if (others > 0) out.push({ key: "returns.effect.otherBikes", vars: { n: others, uom } });
  return out;
}
