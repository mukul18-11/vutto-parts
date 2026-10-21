// The 90-day before/after simulation (SPEC §15, seed catalogue §5). Each working day (Monday to
// Saturday) runs fixed phases, each in its own time window so the ledger stays in time order:
//   09:30 deliveries (GRN, then putaway)     10:00 purchases (after period: confirm at purchase;
//                                            the bike arrives 2–5 days later)
//   11:00 arrivals                           12:00 bay-ins (before period: confirm here) and issues
//   14:00 emergency buys for blocked bikes   16:00 closes (repair done, every part fitted)
//   18:00 draft PO generation, sent the same day (skipped on the last simulated day)
// Planted steps use the gaps (13:00, 15:00, 17:00, 18:30).
import {
  FINDING_TYPES,
  MODELS,
  PARTS,
  VARIANTS,
  autoPick,
  type SupplierKey,
  type Variant,
  type WorkshopCode,
} from "./catalogue";
import { requirement, time, regNo, type Ctx } from "./context";
import { World, type Bike, type Card, type Po } from "./engine";
import { isSunday, SIM_DAYS } from "./time";

/** Purchases per working day (SPEC §1): NCR ~32, JPR ~6–7. */
const PURCHASES: Record<WorkshopCode, (rng: () => number) => number> = {
  NCR: (rng) => 30 + Math.floor(rng() * 5),
  JPR: (rng) => 6 + (rng() < 0.5 ? 1 : 0),
};

/** "Before" (days −90..−46): cards confirmed at bay-in. "After" (−45..−1): at purchase. */
export const AFTER_FROM_DAY = -45;
/** No simulated emergency buys in the last 7 days (the planted ones are the 1–2 shown there). */
const NO_SIM_EMERGENCY_FROM = -7;
// §5.7 caps findings at 5 per bike; at 5 the template exceeds the 60,000-row budget, so the cap is 4.
export const MAX_FINDINGS = 4;
/**
 * Purchase to arrival: 2–5 days (pickup from the seller, RC and NOC paperwork). A card confirmed at
 * purchase sends its PO that evening, so parts from the 3-day OEM distributor are usually in before
 * the bike; only the 5- and 7-day dealer parts (RE, Honda) still make an after-period bike wait.
 */
const TRANSIT_MIN = 2;
const TRANSIT_SPAN = 4;

const VENDORS: Record<WorkshopCode, string[]> = {
  NCR: ["Karol Bagh spares counter", "Kashmere Gate local shop", "Mayapuri spares market"],
  JPR: ["Jaipur local spares shop", "MI Road spares counter"],
};

type SimBike = {
  bike: Bike;
  card: Card;
  before: boolean;
  arriveDay: number;
  bayDay: number;
  closeDay: number;
  /** Emergency-buy decision, drawn once when the bike has been blocked for more than a day. */
  emergency: boolean | null;
};

function nextWorkday(day: number): number {
  let d = day;
  while (isSunday(d)) d++;
  return d;
}

function pickWeighted<T>(rng: () => number, items: readonly T[], weight: (x: T) => number): T {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let r = rng() * total;
  for (const x of items) {
    r -= weight(x);
    if (r < 0) return x;
  }
  return items[items.length - 1];
}

/** Integer paise × (1 + bp/10000), rounded. */
function adjust(paise: number, bp: number): number {
  return Math.max(1, Math.round((paise * (10000 + bp)) / 10000));
}

export class Simulator {
  private bikes: SimBike[] = [];
  private deliveries = new Map<number, Po[]>();
  private invoiceSeq = 0;
  private poSeq = 0;

  constructor(
    private c: Ctx,
    /** SKUs the simulation never draws or orders (planted dead stock and planted PO parts). */
    private excluded: Set<string>,
  ) {}

  private get w(): World {
    return this.c.w;
  }

  /** Registers this workshop's phases for one working day. */
  scheduleDay(day: number): void {
    const s = this.c.schedule;
    s.add(time(day, 9, 30), () => this.deliver(day));
    s.add(time(day, 10, 0), () => this.purchase(day));
    s.add(time(day, 11, 0), () => this.arrivals(day));
    s.add(time(day, 12, 0), () => this.bayAndIssue(day));
    s.add(time(day, 14, 0), () => this.emergencies(day));
    s.add(time(day, 16, 0), () => this.closes(day));
    if (day < -1) s.add(time(day, 18, 0), () => this.generateAndSend(day));
  }

  // -------------------------------------------------------------------------------------------

  /** Findings for one bike (seed catalogue §5.7): each eligible one drawn with its freq, 2–5. */
  private drawFindings(v: Variant): string[] {
    const { rng, w } = this.c;
    const drawn: string[] = [];
    for (const f of FINDING_TYPES) {
      if (!f.eligible(v)) continue;
      // Never on ACT_3G/4G (the planted unsourced speedometer is the only one, §5.5).
      if (f.code === "speedometer_not_working" && (v.key === "ACT_3G" || v.key === "ACT_4G")) continue;
      const pick = autoPick(f.code, v.modelKey, v.key, (sku, vk) => w.fitment(sku, vk));
      if (pick && this.excluded.has(pick.sku)) continue;
      if (rng() < f.freq(v)) drawn.push(f.code);
    }
    while (drawn.length > MAX_FINDINGS) {
      const droppable = drawn.filter((x) => x !== "engine_oil_due");
      drawn.splice(drawn.indexOf(droppable[Math.floor(rng() * droppable.length)]), 1);
    }
    for (const extra of ["engine_oil_due", "air_filter_dirty"]) {
      if (drawn.length < 2 && !drawn.includes(extra)) drawn.push(extra);
    }
    return drawn;
  }

  private purchase(day: number): void {
    const { rng, ws } = this.c;
    const n = PURCHASES[ws](rng);
    for (let i = 0; i < n; i++) {
      const model = pickWeighted(rng, MODELS, (m) => m.mix);
      const v = pickWeighted(rng, VARIANTS.filter((x) => x.modelKey === model.key), (x) => x.weight);
      const to = Math.min(v.yearTo ?? 2025, 2025);
      const year = v.yearFrom + Math.floor(rng() * (to - v.yearFrom + 1));
      const findings = this.drawFindings(v);
      const t = time(day, 10, Math.min(i, 59));
      const { bike, card } = this.w.createBike({ key: `${ws}:sim:${day}:${i}`, ws, regNo: regNo(this.c), modelKey: model.key, variantKey: v.key, mfgYear: year, findings, t });
      const before = day < AFTER_FROM_DAY;
      if (!before) this.w.confirmCard(card, t);
      const arriveDay = nextWorkday(day + TRANSIT_MIN + Math.floor(rng() * TRANSIT_SPAN));
      const bayDay = nextWorkday(arriveDay + Math.floor(rng() * 3));
      const closeDay = nextWorkday(bayDay + 1 + Math.floor(rng() * 2));
      this.bikes.push({ bike, card, before, arriveDay, bayDay, closeDay, emergency: null });
    }
  }

  private arrivals(day: number): void {
    let i = 0;
    for (const b of this.bikes) {
      if (b.bike.status === "purchased" && b.arriveDay <= day) this.w.markArrived(b.bike, time(day, 11, Math.min(i++, 59)));
    }
  }

  private bayAndIssue(day: number): void {
    let i = 0;
    for (const b of this.bikes) {
      if (b.bike.status === "at_workshop" && b.bayDay <= day) {
        const t = time(day, 12, Math.min(i++, 59));
        if (b.card.status === "draft") this.w.confirmCard(b.card, t);
        this.w.startRepair(b.bike, t);
      }
    }
    for (const b of this.bikes) {
      if (b.bike.status !== "in_repair") continue;
      if (this.w.cardLines(b.card.id).some((l) => l.cancelledAt === null && l.qtyReserved > 0)) {
        this.w.issueAll(b.card, time(day, 12, Math.min(i++, 59)));
      }
    }
  }

  /** Bikes blocked in a bay for more than a day: often an emergency buy before, rarely after. */
  private emergencies(day: number): void {
    const { rng, ws } = this.c;
    if (day >= NO_SIM_EMERGENCY_FROM) return;
    let i = 0;
    for (const b of this.bikes) {
      if (b.bike.status !== "in_repair" || b.card.partsCompleteAt !== null || day - b.bayDay < 2) continue;
      if (b.emergency === null) b.emergency = rng() < (b.before ? 0.6 : 0.05);
      if (!b.emergency) continue;
      for (const line of this.w.cardLines(b.card.id)) {
        const need = line.cancelledAt === null ? World.uncovered(line) : 0;
        if (need <= 0) continue;
        const t = time(day, 14, Math.min(i++, 59));
        const r = requirement(this.w, ws, line.sku, day, this.c.settings.get(line.sku)!);
        const ref = this.w.defaultPrice(r.supplier, line.sku);
        const premiumBp = 1500 + Math.floor(rng() * 2501); // 15–40%
        const vendor = VENDORS[ws][Math.floor(rng() * VENDORS[ws].length)];
        this.w.emergencyBuy(`${ws}:sim:${b.card.key}:${line.id}`, line, need, adjust(ref, premiumBp), vendor, r.onOrder > 0 ? "supplier_late" : "no_stock", null, t);
      }
      this.w.issueAll(b.card, time(day, 14, Math.min(i, 59)));
    }
  }

  private closes(day: number): void {
    let i = 0;
    for (const b of this.bikes) {
      if (b.bike.status !== "in_repair" || b.closeDay > day || b.card.partsCompleteAt === null) continue;
      const t = time(day, 16, Math.min(i++, 59));
      this.w.issueAll(b.card, t);
      const open = this.w.cardLines(b.card.id).some((l) => l.cancelledAt === null && (l.qtyReserved > 0 || l.qtyIssued - l.qtyReturned !== l.qtyRequired));
      if (!open) this.w.closeCard(b.card, t);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Purchasing: generate_draft_pos (§7.1) every evening, every draft sent the same day; delivery
  // on the expected date ± 1 day, sometimes short or with damaged units (the rest follows later).

  private generateAndSend(day: number): void {
    const { ws, settings } = this.c;
    const bySupplier = new Map<SupplierKey, { sku: string; qty: number }[]>();
    for (const part of PARTS) {
      if (this.excluded.has(part.sku)) continue;
      const r = requirement(this.w, ws, part.sku, day, settings.get(part.sku)!);
      if (r.orderQty <= 0 || !r.supplier) continue;
      bySupplier.set(r.supplier, [...(bySupplier.get(r.supplier) ?? []), { sku: part.sku, qty: r.orderQty }]);
    }
    let i = 0;
    for (const supplier of [...bySupplier.keys()].sort()) {
      const po = this.w.sendPo(`${ws}:sim:${++this.poSeq}`, ws, supplier, bySupplier.get(supplier)!, time(day, 18, Math.min(i++, 30)));
      const jitter = [-1, 0, 0, 0, 1][Math.floor(this.c.rng() * 5)];
      this.scheduleDelivery(po, Math.max(day + 1, po.expectedOn! + jitter));
    }
  }

  private scheduleDelivery(po: Po, day: number): void {
    const d = nextWorkday(day);
    if (d >= 0) return; // still on its way at the anchor
    this.deliveries.set(d, [...(this.deliveries.get(d) ?? []), po]);
  }

  private deliver(day: number): void {
    const { rng, ws } = this.c;
    const due = this.deliveries.get(day) ?? [];
    this.deliveries.delete(day);
    let i = 0;
    for (const po of due) {
      const t = time(day, 9, 30 + Math.min(i++, 29));
      const lines = this.w.poLinesOf(po.id)
        .map((pl) => ({ pl, open: pl.qtyOrdered - pl.qtyAccepted - pl.qtyCancelled }))
        .filter((x) => x.open > 0)
        .map(({ pl, open }) => {
          const short = open >= 2 && rng() < 0.05 ? Math.ceil(open / 3) : 0;
          const received = open - short;
          const damaged = rng() < 0.04 ? 1 : 0;
          // Invoice price: ±3% usually, a 5–8% variance now and then.
          const big = rng() < 0.08;
          const sign = rng() < 0.5 ? -1 : 1;
          const bp = big ? sign * (500 + Math.floor(rng() * 301)) : Math.floor(rng() * 601) - 300;
          return { poLineId: pl.id, received, damaged, pricePaise: adjust(pl.pricePaise, bp) };
        });
      if (lines.length === 0) continue;
      const first = this.w.grnLines.length;
      this.w.receiveGrn(`${ws}:sim:${po.id}:${day}`, po, lines, `${po.supplier}/${ws}/${String(++this.invoiceSeq).padStart(5, "0")}`, t);
      // Put everything accepted away into its home bin.
      for (const gl of this.w.grnLines.slice(first).filter((x) => x.accepted > 0)) {
        this.w.putaway(ws, gl.sku, this.c.home.get(gl.sku)!, gl.accepted, t);
      }
      if (po.status === "partially_received" || po.status === "sent") {
        this.scheduleDelivery(po, day + 2 + Math.floor(rng() * 2));
      }
    }
  }
}

export const SIM_FIRST_DAY = -SIM_DAYS;
