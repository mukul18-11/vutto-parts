// Planted demo scenarios (SPEC §15, seed catalogue §5.9), registered as timed steps that the day
// loop runs alongside the simulation. Planted steps use the gaps between the simulator's daily
// phases (13:00, 15:00, 17:00, 18:30), so the ledger stays in time order. Their actions are written
// to activity_log (planted entities only, SPEC §15). The codes end up in scripts/seed/planted.json.
import {
  autoPick,
  catalogueFitments,
  DEAD_STOCK,
  FINDING_TYPES,
  FLAG_NOTE,
  PART_BY_SKU,
  PARTS,
  UNSOURCED_SKU,
  VARIANT_BY_KEY,
  VARIANTS,
  type WorkshopCode,
} from "./catalogue";
import { midYear, regNo, requirement, time, type Ctx } from "./context";
import { SeedError, World, type Bike, type Card, type Line } from "./engine";
import { dateStr } from "./time";

export type PlantedChain = { label: "A" | "B" | "C"; card_code: string; reg_no: string; po_code: string; sku: string; qty: number; expected_on: string };

export type PlantedWorkshop = {
  chains: PlantedChain[];
  po_due_tomorrow: string;
  po_overdue: string;
  po_partially_received: string;
  receiving: { sku: string; qty: number; reserved_for: string[] };
  ready_to_issue: string[];
  blocked: { in_transit: string[]; overdue_po: string[]; not_ordered: string[]; flagged_fitment: string[] };
  inbound_shortfall: string[];
  low_stock_auto_skus: string[];
  dead_stock_skus: string[];
  emergency_buy_cards: string[];
  unsourced: { sku: string; card_code: string };
  unknown_variant: { card_code: string; reg_no: string };
  flagged_fitment: { sku: string; variant: string; card_code: string } | null;
};

export type Planted = { template_anchor_date: string } & Record<WorkshopCode, PlantedWorkshop>;

type Spec = { variant: string; finding: string };
type ChainSpec = Spec & { label: "A" | "B" | "C"; sentDay: number };

const PLAN: Record<WorkshopCode, {
  chains: ChainSpec[];
  overdue: Spec & { sentDay: number };
  partial: { variants: [string, string, string]; finding: string; sentDay: number };
  ready: { variant: string; findings: string[] }[];
  unsourced: string;
  emergency: Spec;
}> = {
  NCR: {
    // S1 lead 3, S4 lead 5: A due tomorrow, B and C due in 2 days.
    chains: [
      { label: "A", variant: "SPL_BS6_S", finding: "headlamp_broken", sentDay: -2 },
      { label: "B", variant: "P150_BS6_SD", finding: "side_panel_cracked", sentDay: -1 },
      { label: "C", variant: "C350_J_RED", finding: "speedometer_not_working", sentDay: -3 },
    ],
    // S5 lead 7: sent on day −9, expected anchor−2.
    overdue: { variant: "SHN_BS6_DR", finding: "front_mudguard_cracked", sentDay: -9 },
    // S1 lead 3: sent on day −3, expected today; delivered early on day −1 with one damaged.
    partial: { variants: ["SPL_BS6_K", "SPL_OBD2", "SPL_BS6_S"], finding: "tail_lamp_broken", sentDay: -3 },
    ready: [
      { variant: "HFD_BS6_K", findings: ["engine_oil_due", "rear_brake_worn", "spark_plug_worn"] },
      { variant: "ACT_6G", findings: ["engine_oil_due", "gear_oil_due", "air_filter_dirty"] },
      { variant: "GLM_BS6_DR", findings: ["engine_oil_due", "air_filter_dirty", "mirror_missing_broken"] },
    ],
    unsourced: "ACT_4G",
    emergency: { variant: "APR_BS6_RD", finding: "seat_cover_torn" },
  },
  JPR: {
    // Jaipur buys model_specific parts from S7 (lead 4).
    chains: [
      { label: "A", variant: "SPL_BS6_S", finding: "headlamp_broken", sentDay: -3 },
      { label: "B", variant: "ACT_6G", finding: "side_panel_cracked", sentDay: -2 },
      { label: "C", variant: "P150_BS6_SD", finding: "tail_lamp_broken", sentDay: -2 },
    ],
    overdue: { variant: "SHN_BS6_DR", finding: "front_mudguard_cracked", sentDay: -6 },
    partial: { variants: ["SPL_BS6_K", "SPL_OBD2", "SPL_BS6_S"], finding: "tail_lamp_broken", sentDay: -4 },
    ready: [
      { variant: "SPL_BS4_S", findings: ["engine_oil_due", "rear_brake_worn"] },
      { variant: "ACT_6G", findings: ["engine_oil_due", "gear_oil_due"] },
      { variant: "HFD_BS6_S", findings: ["engine_oil_due", "battery_weak"] },
    ],
    unsourced: "ACT_3G",
    emergency: { variant: "APR_BS6_RD", finding: "seat_cover_torn" },
  },
};

const CATALOGUE_FITS = new Map(catalogueFitments().map((f) => [`${f.sku}|${f.variantKey}`, f]));

function pickSku(variant: string, finding: string): string {
  const v = VARIANT_BY_KEY.get(variant)!;
  const pick = autoPick(finding, v.modelKey, variant, (sku, vk) => CATALOGUE_FITS.get(`${sku}|${vk}`));
  if (!pick) throw new SeedError(`${variant} ${finding} resolves to no part`);
  return pick.sku;
}

/**
 * SKUs the simulator keeps away from (never draws the finding that would consume them, never
 * orders them): the planted dead stock and the parts of the planted PO scenarios, so each
 * planted state is exactly what the scenario built.
 */
export function plantedSkus(ws: WorkshopCode): Set<string> {
  const plan = PLAN[ws];
  return new Set([
    ...DEAD_STOCK[ws].map(([sku]) => sku),
    ...plan.chains.map((c) => pickSku(c.variant, c.finding)),
    pickSku(plan.overdue.variant, plan.overdue.finding),
    ...plan.partial.variants.map((v) => pickSku(v, plan.partial.finding)),
    pickSku(plan.emergency.variant, plan.emergency.finding),
  ]);
}

function lineOf(w: World, card: Card, sku: string): Line {
  const l = w.liveLine(card.id, sku);
  if (!l) throw new SeedError(`${card.code} has no line for ${sku}`);
  return l;
}

function uncoveredSkus(w: World, card: Card): string[] {
  return w.cardLines(card.id).filter((l) => l.cancelledAt === null && World.uncovered(l) > 0).map((l) => l.sku);
}

function expectComplete(w: World, card: Card, what: string): void {
  if (card.partsCompleteAt === null) throw new SeedError(`${what} ${card.code} is not fully reserved: ${uncoveredSkus(w, card).join(",")}`);
}

/** Registers the planted steps of one workshop; the returned record fills in as they run. */
export function planWorkshop(c: Ctx): PlantedWorkshop {
  const { w, ws, schedule } = c;
  const plan = PLAN[ws];
  const p: PlantedWorkshop = {
    chains: [], po_due_tomorrow: "", po_overdue: "", po_partially_received: "",
    receiving: { sku: "", qty: 0, reserved_for: [] }, ready_to_issue: [],
    blocked: { in_transit: [], overdue_po: [], not_ordered: [], flagged_fitment: [] },
    inbound_shortfall: [], low_stock_auto_skus: [], dead_stock_skus: DEAD_STOCK[ws].map(([s]) => s),
    emergency_buy_cards: [], unsourced: { sku: UNSOURCED_SKU, card_code: "" },
    unknown_variant: { card_code: "", reg_no: "" }, flagged_fitment: null,
  };

  // Each step is one action, logged to activity_log.
  const step = (day: number, hh: number, mm: number, run: () => void) =>
    schedule.add(time(day, hh, mm), () => {
      w.logging = true;
      try {
        run();
      } finally {
        w.logging = false;
      }
    });
  const T = time;
  const supplierOf = (sku: string) => {
    const r = requirement(w, ws, sku, 0, c.settings.get(sku)!);
    if (!r.supplier) throw new SeedError(`${sku} has no supplier at ${ws}`);
    return r.supplier;
  };

  /** A planted bike bought at 13:00 on `day`; its card is confirmed at purchase unless told not to. */
  const bike = (key: string, variant: string | null, findings: string[], day: number, then: (r: { bike: Bike; card: Card }) => void, opts: { modelKey?: string; mfgYear?: number; confirm?: boolean } = {}) =>
    step(day, 13, 0, () => {
      const r = w.createBike({
        key: `${ws}:${key}`, ws, regNo: regNo(c), modelKey: opts.modelKey ?? VARIANT_BY_KEY.get(variant!)!.modelKey,
        variantKey: variant, mfgYear: opts.mfgYear ?? midYear(variant!), findings, t: T(day, 13, 0),
      });
      if (opts.confirm !== false) w.confirmCard(r.card, T(day, 13, 1));
      then(r);
    });

  // 1. NCR flagged fitment (§5.9): AF-JUP issued on JUP_BS6_DI, confirmed once, then returned as
  //    wrong fitment three times. The last card stays in a bay with needs_review_reason set.
  if (ws === "NCR") {
    [-40, -30, -20, -3].forEach((day, i) => {
      let r!: { bike: Bike; card: Card };
      bike(`flag:${i}`, "JUP_BS6_DI", ["air_filter_dirty", "engine_oil_due"], day, (x) => (r = x), { confirm: false });
      step(day, 13, 2, () => w.switchLinePart(lineOf(w, r.card, "AF-JUP-BS6"), "AF-JUP", T(day, 13, 2)));
      step(day, 13, 5, () => w.confirmCard(r.card, T(day, 13, 5)));
      step(day, 15, 0, () => w.markArrived(r.bike, T(day, 15, 0)));
      step(day, 15, 10, () => w.startRepair(r.bike, T(day, 15, 10)));
      step(day, 15, 20, () => {
        expectComplete(w, r.card, "flagged-fitment card");
        w.issueAll(r.card, T(day, 15, 20));
      });
      if (i === 0) {
        step(day, 17, 0, () => w.closeCard(r.card, T(day, 17, 0)));
        return;
      }
      step(day, 15, 30, () => w.returnWrongFitment(lineOf(w, r.card, "AF-JUP"), 1, c.home.get("AF-JUP")!, FLAG_NOTE, T(day, 15, 30)));
      if (i === 3) {
        step(day, 15, 31, () => {
          p.blocked.flagged_fitment.push(r.card.code);
          p.flagged_fitment = { sku: "AF-JUP", variant: "JUP_BS6_DI", card_code: r.card.code };
          const f = w.fitment("AF-JUP", "JUP_BS6_DI")!;
          if (f.confirmed !== 1 || f.flagged !== 3) throw new SeedError(`flagged fitment ${f.confirmed}/${f.flagged}`);
        });
        return;
      }
      step(day, 15, 40, () => w.addLine(r.card, "AF-JUP-BS6", 1, "Correct BS6 filter", T(day, 15, 40)));
      step(day, 15, 50, () => {
        expectComplete(w, r.card, "flagged-fitment card");
        w.issueAll(r.card, T(day, 15, 50));
      });
      step(day, 17, 0, () => w.closeCard(r.card, T(day, 17, 0)));
    });
  }

  // 2. Overdue PO: an arrived bike waiting for a part whose PO was due 2 days ago.
  {
    const o = plan.overdue;
    let r!: { bike: Bike; card: Card };
    bike("overdue", o.variant, [o.finding], o.sentDay - 2, (x) => (r = x));
    step(o.sentDay, 13, 30, () => {
      const sku = uncoveredSkus(w, r.card)[0];
      const po = w.sendPo(`${ws}:overdue`, ws, supplierOf(sku), [{ sku, qty: 1 }], T(o.sentDay, 13, 30));
      if (po.expectedOn !== -2) throw new SeedError(`overdue PO expected on day ${po.expectedOn}`);
      p.po_overdue = po.code;
      p.blocked.overdue_po.push(r.card.code);
    });
    step(o.sentDay + 1, 15, 0, () => w.markArrived(r.bike, T(o.sentDay + 1, 15, 0)));
  }

  // 3. Partial receipt with damage: three bikes wait for one part; 2 accepted (left in receiving,
  //    reserved for the two arrived bikes), 1 damaged and still owed to the purchased bike.
  {
    const pr = plan.partial;
    const cards: Card[] = [];
    pr.variants.forEach((variant, i) => {
      const day = [-6, -5, -2][i];
      let r!: { bike: Bike; card: Card };
      bike(`partial:${i}`, variant, [pr.finding], day, (x) => {
        r = x;
        cards[i] = x.card;
      });
      if (i < 2) step(day + 1, 15, 0, () => w.markArrived(r.bike, T(day + 1, 15, 0)));
    });
    let poKey!: string;
    step(pr.sentDay, 13, 30, () => {
      const sku = uncoveredSkus(w, cards[0])[0];
      const po = w.sendPo(`${ws}:partial`, ws, supplierOf(sku), [{ sku, qty: 3 }], T(pr.sentDay, 13, 30));
      if (po.expectedOn! < 0) throw new SeedError("partial PO must not be overdue");
      poKey = po.id;
    });
    step(-1, 17, 0, () => {
      const po = w.po(poKey);
      const pl = w.poLinesOf(po.id)[0];
      w.receiveGrn(`${ws}:partial`, po, [{ poLineId: pl.id, received: 3, damaged: 1, pricePaise: Math.round((pl.pricePaise * 106) / 100) }], `INV-${ws}-0417`, T(-1, 17, 0));
      if (po.status !== "partially_received") throw new SeedError(`partial PO status ${po.status}`);
      p.po_partially_received = po.code;
      p.receiving = { sku: pl.sku, qty: w.onHand(w.rcv(ws), pl.sku), reserved_for: cards.slice(0, 2).map((x) => x.code) };
      p.inbound_shortfall.push(cards[2].code);
      for (const x of cards.slice(0, 2)) expectComplete(w, x, "partial-receipt card");
    });
  }

  // 4. Ready to issue: fully reserved, on bikes at the workshop or in a bay, nothing issued.
  plan.ready.forEach((rs, i) => {
    const day = -3 + (i % 2);
    let r!: { bike: Bike; card: Card };
    bike(`ready:${i}`, rs.variant, rs.findings, day, (x) => {
      r = x;
      expectComplete(w, x.card, "ready card");
      p.ready_to_issue.push(x.card.code);
    });
    step(day, 15, 0, () => w.markArrived(r.bike, T(day, 15, 0)));
    if (i === 2) step(day, 15, 10, () => w.startRepair(r.bike, T(day, 15, 10)));
  });

  // 5. Not ordered: the unsourced part (no supplier anywhere) on an arrived bike.
  {
    let r!: { bike: Bike; card: Card };
    bike("unsourced", plan.unsourced, ["speedometer_not_working"], -5, (x) => {
      r = x;
      lineOf(w, x.card, UNSOURCED_SKU);
      p.unsourced.card_code = x.card.code;
      p.blocked.not_ordered.push(x.card.code);
    });
    step(-4, 15, 0, () => w.markArrived(r.bike, T(-4, 15, 0)));
  }

  // 6. Emergency buy on day −4 (+25% at a local counter); the card closes the next day.
  {
    const e = plan.emergency;
    let r!: { bike: Bike; card: Card };
    bike("emergency", e.variant, [e.finding], -6, (x) => (r = x));
    step(-5, 15, 0, () => w.markArrived(r.bike, T(-5, 15, 0)));
    step(-4, 15, 0, () => w.startRepair(r.bike, T(-4, 15, 0)));
    step(-4, 15, 10, () => {
      const line = w.cardLines(r.card.id).find((l) => World.uncovered(l) > 0);
      if (!line) throw new SeedError("emergency card has nothing missing");
      const ref = w.defaultPrice(requirement(w, ws, line.sku, 0, c.settings.get(line.sku)!).supplier, line.sku);
      w.emergencyBuy(`${ws}:emergency`, line, 1, Math.round((ref * 125) / 100), ws === "NCR" ? "Karol Bagh spares counter" : "Jaipur local spares shop", "no_stock", "Bike in bay, no stock", T(-4, 15, 10));
      p.emergency_buy_cards.push(r.card.code);
    });
    step(-3, 17, 0, () => w.closeCard(r.card, T(-3, 17, 0)));
  }

  // 7. Demo chains A/B/C: in_repair bikes blocked on exactly one part, covered exactly by their
  //    own single-line sent PO (A due tomorrow).
  for (const ch of plan.chains) {
    let r!: { bike: Bike; card: Card };
    bike(`chain:${ch.label}`, ch.variant, [ch.finding], ch.sentDay - 2, (x) => (r = x));
    step(ch.sentDay - 1, 15, 0, () => w.markArrived(r.bike, T(ch.sentDay - 1, 15, 0)));
    step(ch.sentDay, 15, 0, () => w.startRepair(r.bike, T(ch.sentDay, 15, 0)));
    step(ch.sentDay, 15, 10, () => {
      const missing = uncoveredSkus(w, r.card);
      if (missing.length !== 1) throw new SeedError(`chain ${ch.label} misses ${missing.join(",")}`);
      const sku = missing[0];
      const qty = World.uncovered(lineOf(w, r.card, sku));
      const po = w.sendPo(`${ws}:chain:${ch.label}`, ws, supplierOf(sku), [{ sku, qty }], T(ch.sentDay, 15, 10));
      if (po.expectedOn! < 1) throw new SeedError(`chain ${ch.label} PO is not in the future`);
      if (ch.label === "A") {
        if (po.expectedOn !== 1) throw new SeedError(`chain A PO due on day ${po.expectedOn}, not tomorrow`);
        p.po_due_tomorrow = po.code;
      }
      // Listed A, B, C whatever order the POs went out in.
      p.chains[["A", "B", "C"].indexOf(ch.label)] = { label: ch.label, card_code: r.card.code, reg_no: r.bike.regNo, po_code: po.code, sku, qty, expected_on: dateStr(po.expectedOn!) };
      p.blocked.in_transit.push(r.card.code);
    });
  }

  // 8. Unknown variant: draft card; front_brake_worn cannot resolve without the brake type.
  bike("unknown", null, ["front_brake_worn", "indicator_broken"], -1, ({ bike: b, card }) => {
    p.unknown_variant = { card_code: card.code, reg_no: b.regNo };
  }, { modelKey: "ACT", mfgYear: 2019, confirm: false });

  // 9. After the last simulated day (no draft generation on it): at least 5 auto parts at or below
  //    their reorder point with nothing on order. Service bikes repaired late on day −1 use up the
  //    parts closest to their reorder point until 5 qualify.
  step(-1, 18, 30, () => {
    const low = () => lowStockAutoSkus(c);
    let k = 0;
    const tried = new Set<string>();
    while (low().length < 5) {
      const cand = PARTS.map((part) => ({ part, r: requirement(w, ws, part.sku, 0, c.settings.get(part.sku)!) }))
        .filter(({ part, r }) => r.isAuto && r.onOrder === 0 && !w.hasOpenPoLine(ws, part.sku) && !tried.has(part.sku) && r.projected - r.rop! <= 3 && w.available(ws, part.sku) >= r.projected - r.rop!)
        .sort((a, b) => a.r.projected - a.r.rop! - (b.r.projected - b.r.rop!) || (a.part.sku < b.part.sku ? -1 : 1))[0];
      if (!cand) throw new SeedError(`${ws}: not enough auto parts near their reorder point`);
      tried.add(cand.part.sku);
      const how = serviceFinding(cand.part.sku);
      if (!how) continue;
      while (requirement(w, ws, cand.part.sku, 0, c.settings.get(cand.part.sku)!).projected > requirement(w, ws, cand.part.sku, 0, c.settings.get(cand.part.sku)!).rop!) {
        if (++k > 25) throw new SeedError(`${ws}: too many service bikes`);
        const t = T(-1, 18, 30 + k);
        const r = w.createBike({ key: `${ws}:service:${k}`, ws, regNo: regNo(c), modelKey: VARIANT_BY_KEY.get(how.variant)!.modelKey, variantKey: how.variant, mfgYear: midYear(how.variant), findings: [how.finding], t });
        w.confirmCard(r.card, t);
        expectComplete(w, r.card, "service card");
        w.markArrived(r.bike, t);
        w.startRepair(r.bike, t);
        w.issueAll(r.card, t);
        w.closeCard(r.card, t);
      }
    }
    p.low_stock_auto_skus = low();
  });

  return p;
}

/** Auto parts at or below their reorder point with nothing on order (as of the anchor). */
export function lowStockAutoSkus(c: Ctx): string[] {
  return PARTS.filter((part) => {
    const r = requirement(c.w, c.ws, part.sku, 0, c.settings.get(part.sku)!);
    return r.isAuto && r.projected <= r.rop! && r.onOrder === 0 && !c.w.hasOpenPoLine(c.ws, part.sku);
  }).map((part) => part.sku);
}

/** A variant and finding whose auto-pick is this SKU (for planted service bikes). */
function serviceFinding(sku: string): { variant: string; finding: string } | null {
  const part = PART_BY_SKU.get(sku)!;
  for (const f of FINDING_TYPES) {
    if (!f.mappings.some((m) => m.partType === part.partType)) continue;
    for (const v of VARIANTS) {
      if (!f.eligible(v)) continue;
      if (pickSkuOrNull(v.key, f.code) === sku) return { variant: v.key, finding: f.code };
    }
  }
  return null;
}

function pickSkuOrNull(variant: string, finding: string): string | null {
  const v = VARIANT_BY_KEY.get(variant)!;
  return autoPick(finding, v.modelKey, variant, (sku, vk) => CATALOGUE_FITS.get(`${sku}|${vk}`))?.sku ?? null;
}
