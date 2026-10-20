// Shared pieces of the seed generator: the day-by-day event schedule, the per-workshop context,
// and the SPEC §7.1 requirement formula (mirror of private.po_requirements).
import {
  jaipurSupplier,
  PART_BY_SKU,
  preferredSupplier,
  SUPPLIER_BY_KEY,
  VARIANT_BY_KEY,
  type ReorderSetting,
  type SupplierKey,
  type WorkshopCode,
} from "./catalogue";
import { SeedError, type World } from "./engine";
import { at, DAY_END, DAY_START, dayOf, isSunday } from "./time";

/** Timed actions, run in (time, registration) order inside the day loop. */
export class Schedule {
  private byDay = new Map<number, { t: number; seq: number; run: () => void }[]>();
  private seq = 0;

  add(t: number, run: () => void): void {
    const day = dayOf(t);
    const list = this.byDay.get(day) ?? [];
    list.push({ t, seq: this.seq++, run });
    this.byDay.set(day, list);
  }

  take(day: number): { t: number; seq: number; run: () => void }[] {
    const list = this.byDay.get(day) ?? [];
    this.byDay.delete(day);
    return list;
  }

  pendingDays(): number[] {
    return [...this.byDay.keys()];
  }
}

export type Ctx = {
  w: World;
  rng: () => number;
  ws: WorkshopCode;
  settings: Map<string, ReorderSetting>;
  home: Map<string, string>;
  regSeq: { n: number };
  schedule: Schedule;
};

/** A time on a working day between 09:30 and 19:00 IST (events never fall on Sundays or today). */
export function time(day: number, hh: number, mm = 0): number {
  if (day >= 0) throw new SeedError(`event on day ${day} (only anchor−180..anchor−1)`);
  if (isSunday(day)) throw new SeedError(`event on a Sunday (day ${day})`);
  const min = hh * 60 + mm;
  if (min < DAY_START || min > DAY_END) throw new SeedError(`event outside 09:30–19:00 (${hh}:${mm})`);
  return at(day, min);
}

const REG_PREFIX: Record<WorkshopCode, string[]> = {
  NCR: ["DL3S", "DL4S", "DL5S", "DL8S", "DL9S", "DL1S", "HR26", "UP16"],
  JPR: ["RJ14", "RJ45", "RJ60", "RJ02"],
};
const LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";

/** A unique registration number: the sequence fixes the digits, the PRNG varies the letters. */
export function regNo(c: Ctx): string {
  const n = ++c.regSeq.n;
  if (n >= 9000) throw new SeedError("registration numbers exhausted");
  const prefixes = REG_PREFIX[c.ws];
  const l1 = LETTERS[Math.floor(c.rng() * LETTERS.length)];
  const l2 = LETTERS[Math.floor(c.rng() * LETTERS.length)];
  // 7919 is coprime with 9000, so the 4 digits never repeat.
  return `${prefixes[n % prefixes.length]}${l1}${l2}${1000 + ((n * 7919) % 9000)}`;
}

export function midYear(variantKey: string): number {
  const v = VARIANT_BY_KEY.get(variantKey)!;
  return Math.floor((v.yearFrom + Math.min(v.yearTo ?? 2025, 2025)) / 2);
}

export function effectiveSupplier(ws: WorkshopCode, sku: string): SupplierKey | null {
  const p = PART_BY_SKU.get(sku)!;
  return ws === "JPR" ? jaipurSupplier(p) : preferredSupplier(p);
}

export type Requirement = {
  isAuto: boolean;
  projected: number;
  onOrder: number;
  rop: number | null;
  orderQty: number;
  supplier: SupplierKey | null;
};

/** SPEC §7.1 for one part, as of IST day `asOf` (issues counted over asOf−28..asOf−1). */
export function requirement(w: World, ws: WorkshopCode, sku: string, asOf: number, s: ReorderSetting): Requirement {
  const isAuto = s.auto && PART_BY_SKU.get(sku)!.category !== "model_specific";
  const onOrder = w.onOrder(ws, sku);
  const projected = w.usable(ws, sku) + onOrder - w.outstanding(ws, sku);
  const supplier = effectiveSupplier(ws, sku);
  if (!isAuto) return { isAuto, projected, onOrder, rop: null, orderQty: Math.max(0, -projected), supplier };
  const first = w.firstIssueDay(ws);
  const enough = first !== undefined && first <= asOf - 7;
  const net = Math.max(0, w.netIssued(ws, sku, asOf - 28, asOf - 1));
  const lead = supplier ? SUPPLIER_BY_KEY.get(supplier)!.leadTimeDays : 0;
  const rop = (enough ? Math.floor((net * lead + 27) / 28) : 0) + s.safetyStock;
  const orderQty = projected <= rop ? Math.max(s.maxQty, rop + 1) - projected : 0;
  return { isAuto, projected, onOrder, rop, orderQty, supplier };
}
