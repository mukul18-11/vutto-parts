// In-memory mirror of the stock and job card RPCs (SPEC §5–§8), used by the seed generator so
// every computed column (line quantities, reservations, parts_complete_at, PO counters and
// status, fitment counts, stock balances) is exactly what the RPCs would have produced.
// Deterministic: uuids are UUIDv5 of stable names; times are integer minutes (scripts/seed/time.ts).
import { v5 } from "uuid";
import { DEMO_USERS, WORKSHOP_IDS } from "../../tests/db/demo-users";
import {
  autoPick,
  FINDING_BY_CODE,
  PART_BY_SKU,
  SUPPLIER_BY_KEY,
  VARIANT_BY_KEY,
  type Fitment,
  type SupplierKey,
  type WorkshopCode,
} from "./catalogue";
import { dayOf } from "./time";

const NAMESPACE = "6b2f3c1e-9a4d-5e8f-b1c2-3d4e5f607182";

/** Deterministic uuid for a seed entity name, e.g. "part:OIL-20W40-1L". */
export function uid(name: string): string {
  return v5(name, NAMESPACE);
}

export type Role = "admin" | "manager" | "store";

export function userId(ws: WorkshopCode | null, role: Role): string {
  const key = role === "admin" ? "admin" : `${ws!.toLowerCase()}_${role === "manager" ? "manager" : "store"}`;
  return DEMO_USERS.find((u) => u.key === key)!.id;
}

export const WS_ID: Record<WorkshopCode, string> = WORKSHOP_IDS;

export type BinKind = "normal" | "receiving" | "quarantine";
export type Bin = { id: string; ws: WorkshopCode; code: string; kind: BinKind; createdAt: number };

export type Bike = {
  id: string;
  ws: WorkshopCode;
  regNo: string;
  modelKey: string;
  variantKey: string | null;
  mfgYear: number;
  status: "purchased" | "at_workshop" | "in_repair" | "ready" | "cancelled";
  purchasedAt: number;
  arrivedAt: number | null;
  bayInAt: number | null;
  readyAt: number | null;
  createdAt: number;
};

export type Finding = {
  id: string;
  ws: WorkshopCode;
  bikeId: string;
  code: string;
  lineId: string | null;
  createdAt: number;
};

export type Card = {
  id: string;
  key: string;
  ws: WorkshopCode;
  code: string;
  bikeId: string;
  status: "draft" | "confirmed" | "closed" | "cancelled";
  neededBy: number | null;
  needsReview: string | null;
  confirmedAt: number | null;
  confirmedBy: string | null;
  partsCompleteAt: number | null;
  closedAt: number | null;
  createdAt: number;
  lineCount: number;
};

export type Line = {
  id: string;
  ws: WorkshopCode;
  cardId: string;
  sku: string;
  qtyRequired: number;
  qtyReserved: number;
  qtyIssued: number;
  qtyReturned: number;
  source: "suggested" | "manual" | "extra";
  addedReason: string | null;
  cancelledAt: number | null;
  cancelReason: string | null;
  createdAt: number;
};

export type Po = {
  id: string;
  ws: WorkshopCode;
  code: string;
  supplier: SupplierKey;
  status: "draft" | "sent" | "partially_received" | "received" | "closed" | "cancelled";
  sentAt: number | null;
  expectedOn: number | null;
  createdAt: number;
};

export type PoLine = {
  id: string;
  ws: WorkshopCode;
  poId: string;
  sku: string;
  qtyOrdered: number;
  qtyAccepted: number;
  qtyRejected: number;
  qtyCancelled: number;
  pricePaise: number;
  source: "suggested" | "manual";
  createdAt: number;
};

export type Grn = {
  id: string;
  ws: WorkshopCode;
  code: string;
  poId: string;
  supplier: SupplierKey;
  invoiceNo: string;
  invoiceDate: number;
  receivedBy: string;
  receivedAt: number;
  createdAt: number;
};

export type GrnLine = {
  id: string;
  ws: WorkshopCode;
  grnId: string;
  poLineId: string;
  sku: string;
  received: number;
  accepted: number;
  damaged: number;
  wrong: number;
  pricePaise: number;
  createdAt: number;
};

export type EmergencyBuy = {
  id: string;
  ws: WorkshopCode;
  lineId: string;
  sku: string;
  vendor: string;
  qty: number;
  pricePaise: number;
  referencePaise: number;
  qtyIssued: number;
  qtyToStock: number;
  reason: "no_stock" | "supplier_late" | "wrong_part_received" | "other";
  note: string | null;
  boughtBy: string;
  createdAt: number;
};

export type MoveType =
  | "grn" | "putaway" | "move" | "issue" | "return_to_stock" | "return_to_quarantine"
  | "return_to_supplier" | "adjust_in" | "adjust_out" | "emergency_in";

export type Move = {
  id: number;
  ws: WorkshopCode;
  sku: string;
  type: MoveType;
  qty: number;
  fromBin: string | null;
  toBin: string | null;
  lineId: string | null;
  grnLineId: string | null;
  ebId: string | null;
  reason: string | null;
  note: string | null;
  userId: string | null;
  createdAt: number;
};

export type Activity = {
  id: number;
  ws: WorkshopCode | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: Record<string, unknown>;
  userId: string;
  createdAt: number;
};

export type FitmentState = Fitment & { lastFlagNote: string | null; lastFlaggedAt: number | null; createdAt: number };

export class SeedError extends Error {}

export class World {
  bins = new Map<string, Bin>(); // by code
  bikes: Bike[] = [];
  findings: Finding[] = [];
  cards: Card[] = [];
  lines: Line[] = [];
  pos: Po[] = [];
  poLines: PoLine[] = [];
  grns: Grn[] = [];
  grnLines: GrnLine[] = [];
  emergencyBuys: EmergencyBuy[] = [];
  moves: Move[] = [];
  activity: Activity[] = [];
  fitments = new Map<string, FitmentState>();

  private balances = new Map<string, number>(); // `${binCode}|${sku}`
  private usableBy = new Map<string, number>(); // `${ws}|${sku}`
  /** Lines that can still hold or need stock (closed cards are dropped), per `${ws}|${sku}`. */
  private linesBy = new Map<string, Line[]>();
  private linesByCard = new Map<string, Line[]>();
  private findingsByBike = new Map<string, Finding[]>();
  private cardsByBike = new Map<string, Card[]>();
  private poLinesBy = new Map<string, PoLine[]>(); // `${ws}|${sku}`
  private poLinesByPo = new Map<string, PoLine[]>();
  /** Net issued (issue − job card returns) per `${ws}|${sku}` and IST day. */
  private issueHist = new Map<string, Map<number, number>>();
  private firstIssue = new Map<WorkshopCode, number>();
  private cardById = new Map<string, Card>();
  private bikeById = new Map<string, Bike>();
  private lineById = new Map<string, Line>();
  private poById = new Map<string, Po>();
  private poLineById = new Map<string, PoLine>();
  private counters = new Map<string, number>();
  private lastGrnPrice = new Map<string, { at: number; price: number }>();
  /** When set, every action also writes its activity_log row (planted entities only, SPEC §15). */
  logging = false;

  constructor(
    fitments: Fitment[],
    private supplierPrice: (supplier: SupplierKey, sku: string) => number | undefined,
    private effectiveSupplier: (ws: WorkshopCode, sku: string) => SupplierKey | null,
    createdAt: number,
  ) {
    for (const x of fitments) {
      this.fitments.set(`${x.sku}|${x.variantKey}`, { ...x, lastFlagNote: null, lastFlaggedAt: null, createdAt });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Lookups.

  card(id: string): Card {
    return this.cardById.get(id)!;
  }
  bike(id: string): Bike {
    return this.bikeById.get(id)!;
  }
  line(id: string): Line {
    return this.lineById.get(id)!;
  }
  po(id: string): Po {
    return this.poById.get(id)!;
  }
  cardLines(cardId: string): Line[] {
    return this.linesByCard.get(cardId) ?? [];
  }
  liveLine(cardId: string, sku: string): Line | undefined {
    return this.cardLines(cardId).find((l) => l.sku === sku && l.cancelledAt === null);
  }
  bikeFindings(bikeId: string): Finding[] {
    return this.findingsByBike.get(bikeId) ?? [];
  }
  bikeCards(bikeId: string): Card[] {
    return this.cardsByBike.get(bikeId) ?? [];
  }
  fitment(sku: string, variantKey: string): FitmentState | undefined {
    return this.fitments.get(`${sku}|${variantKey}`);
  }
  onHand(binCode: string, sku: string): number {
    return this.balances.get(`${binCode}|${sku}`) ?? 0;
  }
  usable(ws: WorkshopCode, sku: string): number {
    return this.usableBy.get(`${ws}|${sku}`) ?? 0;
  }
  reserved(ws: WorkshopCode, sku: string): number {
    return (this.linesBy.get(`${ws}|${sku}`) ?? []).reduce((s, l) => s + l.qtyReserved, 0);
  }
  available(ws: WorkshopCode, sku: string): number {
    return this.usable(ws, sku) - this.reserved(ws, sku);
  }
  /** sent / partially received open qty (the simulator never leaves manual draft lines). */
  onOrder(ws: WorkshopCode, sku: string): number {
    return (this.poLinesBy.get(`${ws}|${sku}`) ?? [])
      .filter((l) => ["sent", "partially_received"].includes(this.po(l.poId).status))
      .reduce((s, l) => s + l.qtyOrdered - l.qtyAccepted - l.qtyCancelled, 0);
  }
  /** Any open line on a draft, sent or partially received PO. */
  hasOpenPoLine(ws: WorkshopCode, sku: string): boolean {
    return (this.poLinesBy.get(`${ws}|${sku}`) ?? []).some(
      (l) => ["draft", "sent", "partially_received"].includes(this.po(l.poId).status) && l.qtyOrdered - l.qtyAccepted - l.qtyCancelled > 0,
    );
  }
  /** sum(qty_required − net_issued) over live lines on confirmed cards. */
  outstanding(ws: WorkshopCode, sku: string): number {
    return (this.linesBy.get(`${ws}|${sku}`) ?? [])
      .filter((l) => l.cancelledAt === null && this.card(l.cardId).status === "confirmed")
      .reduce((s, l) => s + l.qtyRequired - (l.qtyIssued - l.qtyReturned), 0);
  }
  shortfall(ws: WorkshopCode, sku: string): number {
    return (this.linesBy.get(`${ws}|${sku}`) ?? [])
      .filter((l) => l.cancelledAt === null && this.card(l.cardId).status === "confirmed")
      .reduce((s, l) => s + Math.max(0, World.uncovered(l)), 0);
  }
  /** Net issued over IST days fromDay..toDay (inclusive). */
  netIssued(ws: WorkshopCode, sku: string, fromDay: number, toDay: number): number {
    const h = this.issueHist.get(`${ws}|${sku}`);
    if (!h) return 0;
    let n = 0;
    for (let d = fromDay; d <= toDay; d++) n += h.get(d) ?? 0;
    return n;
  }
  firstIssueDay(ws: WorkshopCode): number | undefined {
    return this.firstIssue.get(ws);
  }
  /** Keys (ws|sku) that have lines still holding or needing stock. */
  openLineKeys(): string[] {
    return [...this.linesBy.entries()].filter(([, ls]) => ls.length > 0).map(([k]) => k);
  }
  /** Normal bins of the workshop holding the part, most stock first. */
  stockBins(ws: WorkshopCode, sku: string, kinds: BinKind[] = ["normal"]): { code: string; onHand: number }[] {
    return [...this.bins.values()]
      .filter((b) => b.ws === ws && kinds.includes(b.kind))
      .map((b) => ({ code: b.code, onHand: this.onHand(b.code, sku) }))
      .filter((b) => b.onHand > 0)
      .sort((a, b) => b.onHand - a.onHand || (a.code < b.code ? -1 : 1));
  }
  rcv(ws: WorkshopCode): string {
    return `${ws}-RCV`;
  }
  qrn(ws: WorkshopCode): string {
    return `${ws}-QRN`;
  }

  static uncovered(l: Line): number {
    return l.qtyRequired - (l.qtyReserved + l.qtyIssued - l.qtyReturned);
  }

  // -------------------------------------------------------------------------------------------
  // Plumbing.

  addBin(ws: WorkshopCode, code: string, kind: BinKind, createdAt: number): void {
    this.bins.set(code, { id: uid(`bin:${code}`), ws, code, kind, createdAt });
  }

  private nextCode(ws: WorkshopCode, type: "job_card" | "po" | "grn"): string {
    const k = `${ws}|${type}`;
    const n = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, n);
    const prefix = type === "job_card" ? "JC" : type === "po" ? "PO" : "GRN";
    return `${prefix}-${ws}-${String(n).padStart(6, "0")}`;
  }

  private log(ws: WorkshopCode | null, entityType: string, entityId: string, action: string, summary: Record<string, unknown>, user: string, t: number): void {
    if (!this.logging) return;
    this.activity.push({ id: this.activity.length + 1, ws, entityType, entityId, action, summary: { simulated: true, ...summary }, userId: user, createdAt: t });
  }

  private addBalance(binCode: string, sku: string, delta: number): void {
    const bin = this.bins.get(binCode);
    if (!bin) throw new SeedError(`unknown bin ${binCode}`);
    const k = `${binCode}|${sku}`;
    const next = (this.balances.get(k) ?? 0) + delta;
    if (next < 0) throw new SeedError(`INSUFFICIENT_BIN_STOCK ${binCode} ${sku}`);
    this.balances.set(k, next);
    if (bin.kind !== "quarantine") {
      const u = `${bin.ws}|${sku}`;
      this.usableBy.set(u, (this.usableBy.get(u) ?? 0) + delta);
    }
  }

  private move(m: Omit<Move, "id">): Move {
    const allowed: Record<MoveType, [BinKind[] | null, BinKind[] | null]> = {
      grn: [null, ["receiving"]],
      putaway: [["receiving"], ["normal"]],
      move: [["normal", "receiving", "quarantine"], ["normal", "quarantine"]],
      issue: [["normal", "receiving"], null],
      return_to_stock: [null, ["normal"]],
      return_to_quarantine: [null, ["quarantine"]],
      return_to_supplier: [["quarantine"], null],
      adjust_in: [null, ["normal", "receiving", "quarantine"]],
      adjust_out: [["normal", "receiving", "quarantine"], null],
      emergency_in: [null, ["receiving"]],
    };
    const [from, to] = allowed[m.type];
    const kindOf = (code: string | null) => (code ? this.bins.get(code)!.kind : null);
    const fk = kindOf(m.fromBin);
    const tk = kindOf(m.toBin);
    if ((from === null) !== (fk === null) || (to === null) !== (tk === null) || (fk && !from!.includes(fk)) || (tk && !to!.includes(tk))) {
      throw new SeedError(`BIN_KIND_NOT_ALLOWED ${m.type} ${fk}->${tk}`);
    }
    if (m.qty <= 0) throw new SeedError(`move qty ${m.qty}`);
    if (m.fromBin) this.addBalance(m.fromBin, m.sku, -m.qty);
    if (m.toBin) this.addBalance(m.toBin, m.sku, m.qty);
    if (m.type === "issue" || m.type === "return_to_stock" || m.type === "return_to_quarantine") {
      const k = `${m.ws}|${m.sku}`;
      const day = dayOf(m.createdAt);
      const h = this.issueHist.get(k) ?? new Map<number, number>();
      h.set(day, (h.get(day) ?? 0) + (m.type === "issue" ? m.qty : -m.qty));
      this.issueHist.set(k, h);
      if (m.type === "issue" && !(this.firstIssue.get(m.ws)! <= day)) this.firstIssue.set(m.ws, day);
    }
    const row = { ...m, id: this.moves.length + 1 };
    this.moves.push(row);
    return row;
  }

  private newLine(card: Card, sku: string, qty: number, source: Line["source"], addedReason: string | null, t: number): Line {
    card.lineCount++;
    const l: Line = {
      id: uid(`line:${card.key}:${card.lineCount}`),
      ws: card.ws,
      cardId: card.id,
      sku,
      qtyRequired: qty,
      qtyReserved: 0,
      qtyIssued: 0,
      qtyReturned: 0,
      source,
      addedReason,
      cancelledAt: null,
      cancelReason: null,
      createdAt: t,
    };
    this.lines.push(l);
    this.lineById.set(l.id, l);
    this.linesByCard.set(card.id, [...this.cardLines(card.id), l]);
    const k = `${card.ws}|${sku}`;
    this.linesBy.set(k, [...(this.linesBy.get(k) ?? []), l]);
    return l;
  }

  private checkLine(l: Line): void {
    const net = l.qtyIssued - l.qtyReturned;
    if (l.qtyReturned > l.qtyIssued || l.qtyReserved + net > l.qtyRequired || l.qtyReserved < 0 || l.qtyRequired < 0) {
      throw new SeedError(`line CHECK failed ${JSON.stringify(l)}`);
    }
    if (l.qtyReserved > 0 && this.card(l.cardId).status !== "confirmed") throw new SeedError("reservation on unconfirmed card");
  }

  // -------------------------------------------------------------------------------------------
  // SPEC §5.2 refresh_card_completeness, §6 allocate_free_stock.

  refresh(card: Card, t: number): void {
    if (card.status !== "confirmed") return;
    const complete =
      card.needsReview === null &&
      this.cardLines(card.id).every((l) => l.cancelledAt !== null || World.uncovered(l) <= 0);
    if (complete && card.partsCompleteAt === null) card.partsCompleteAt = t;
    if (!complete && card.partsCompleteAt !== null) card.partsCompleteAt = null;
  }

  allocate(ws: WorkshopCode, sku: string, t: number, priorityLineId: string | null = null): { lineId: string; qty: number }[] {
    let available = this.available(ws, sku);
    const out: { lineId: string; qty: number }[] = [];
    if (available <= 0) return out;
    const cands = (this.linesBy.get(`${ws}|${sku}`) ?? []).filter(
      (l) => l.cancelledAt === null && this.card(l.cardId).status === "confirmed" && World.uncovered(l) > 0,
    );
    cands.sort((a, b) => {
      const pa = a.id === priorityLineId ? 0 : 1;
      const pb = b.id === priorityLineId ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ca = this.card(a.cardId);
      const cb = this.card(b.cardId);
      const na = ca.neededBy ?? Number.MAX_SAFE_INTEGER;
      const nb = cb.neededBy ?? Number.MAX_SAFE_INTEGER;
      if (na !== nb) return na - nb;
      if (ca.confirmedAt! !== cb.confirmedAt!) return ca.confirmedAt! - cb.confirmedAt!;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const touched = new Set<string>();
    for (const l of cands) {
      if (available <= 0) break;
      const take = Math.min(available, World.uncovered(l));
      l.qtyReserved += take;
      available -= take;
      out.push({ lineId: l.id, qty: take });
      touched.add(l.cardId);
    }
    for (const c of touched) this.refresh(this.card(c), t);
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Stock RPC mirrors.

  adjustIn(ws: WorkshopCode, binCode: string, sku: string, qty: number, reason: string, user: string, t: number): void {
    this.move({ ws, sku, type: "adjust_in", qty, fromBin: null, toBin: binCode, lineId: null, grnLineId: null, ebId: null, reason, note: null, userId: user, createdAt: t });
    this.allocate(ws, sku, t);
  }

  putaway(ws: WorkshopCode, sku: string, toBin: string, qty: number, t: number): void {
    const user = userId(ws, "store");
    this.move({ ws, sku, type: "putaway", qty, fromBin: this.rcv(ws), toBin, lineId: null, grnLineId: null, ebId: null, reason: null, note: null, userId: user, createdAt: t });
    this.log(ws, "part", uid(`part:${sku}`), "putaway", { qty, to_bin: toBin }, user, t);
  }

  // -------------------------------------------------------------------------------------------
  // Bikes and job cards.

  createBike(o: {
    key: string;
    ws: WorkshopCode;
    regNo: string;
    modelKey: string;
    variantKey: string | null;
    mfgYear: number;
    findings: string[];
    t: number;
  }): { bike: Bike; card: Card } {
    if (o.variantKey) {
      const v = VARIANT_BY_KEY.get(o.variantKey)!;
      if (v.modelKey !== o.modelKey) throw new SeedError(`variant ${o.variantKey} not of ${o.modelKey}`);
      if (o.mfgYear < v.yearFrom || o.mfgYear > (v.yearTo ?? 2025)) throw new SeedError(`MFG_YEAR_OUT_OF_RANGE ${o.key}`);
    }
    const bike: Bike = {
      id: uid(`bike:${o.key}`), ws: o.ws, regNo: o.regNo, modelKey: o.modelKey, variantKey: o.variantKey,
      mfgYear: o.mfgYear, status: "purchased", purchasedAt: o.t, arrivedAt: null, bayInAt: null, readyAt: null, createdAt: o.t,
    };
    this.bikes.push(bike);
    this.bikeById.set(bike.id, bike);
    const card: Card = {
      id: uid(`card:${o.key}`), key: o.key, ws: o.ws, code: this.nextCode(o.ws, "job_card"), bikeId: bike.id,
      status: "draft", neededBy: null, needsReview: null, confirmedAt: null, confirmedBy: null,
      partsCompleteAt: null, closedAt: null, createdAt: o.t, lineCount: 0,
    };
    this.cards.push(card);
    this.cardById.set(card.id, card);
    this.cardsByBike.set(bike.id, [card]);

    // §9.1: auto-pick per finding, merge findings that resolve to the same part (one finding per
    // type here, so the merged qty is the sum of the picks' qty).
    const fitment = (sku: string, vk: string) => this.fitment(sku, vk);
    o.findings.forEach((code, i) => {
      if (!FINDING_BY_CODE.has(code)) throw new SeedError(`unknown finding ${code}`);
      if (o.findings.indexOf(code) !== i) throw new SeedError(`duplicate finding ${code}`);
      const pick = autoPick(code, o.modelKey, o.variantKey, fitment);
      let lineId: string | null = null;
      if (pick) {
        const existing = this.liveLine(card.id, pick.sku);
        const line = existing ?? this.newLine(card, pick.sku, 0, "suggested", null, o.t);
        line.qtyRequired += pick.qty;
        lineId = line.id;
      }
      const finding = { id: uid(`finding:${o.key}:${i}`), ws: o.ws, bikeId: bike.id, code, lineId, createdAt: o.t };
      this.findings.push(finding);
      this.findingsByBike.set(bike.id, [...this.bikeFindings(bike.id), finding]);
    });
    this.log(o.ws, "bike", bike.id, "create_bike", { reg_no: o.regNo, card_code: card.code }, userId(o.ws, "manager"), o.t);
    return { bike, card };
  }

  /** switch_line_part on a draft card to a part not on the card: the line becomes manual. */
  switchLinePart(line: Line, sku: string, t: number): void {
    const card = this.card(line.cardId);
    if (card.status !== "draft" || this.liveLine(card.id, sku)) throw new SeedError("switch_line_part precondition");
    const bike = this.bike(card.bikeId);
    const k = `${line.ws}|${line.sku}`;
    this.linesBy.set(k, this.linesBy.get(k)!.filter((x) => x !== line));
    line.sku = sku;
    line.source = "manual";
    // merged_line_qty: the linked findings' qty is now the new part's fitment qty (or mapping qty).
    const linked = this.bikeFindings(bike.id).filter((f) => f.lineId === line.id);
    line.qtyRequired = linked.reduce((s, f) => {
      const fit = bike.variantKey ? this.fitment(sku, bike.variantKey) : undefined;
      return s + (fit?.qtyPerBike ?? FINDING_BY_CODE.get(f.code)!.mappings[0].qty);
    }, 0) || line.qtyRequired;
    const nk = `${line.ws}|${sku}`;
    this.linesBy.set(nk, [...(this.linesBy.get(nk) ?? []), line]);
    this.log(line.ws, "job_card_line", line.id, "switch_line_part", { sku }, userId(line.ws, "manager"), t);
  }

  confirmCard(card: Card, t: number): void {
    const bike = this.bike(card.bikeId);
    if (card.status !== "draft" || !["purchased", "at_workshop", "in_repair"].includes(bike.status)) throw new SeedError("confirm precondition");
    if (this.bikeFindings(bike.id).some((f) => f.lineId === null)) throw new SeedError(`UNRESOLVED_FINDINGS ${card.code}`);
    card.status = "confirmed";
    card.confirmedAt = t;
    card.confirmedBy = userId(card.ws, "manager");
    card.neededBy ??= bike.arrivedAt !== null ? dayOf(bike.arrivedAt) : dayOf(bike.purchasedAt) + 2;
    const parts = [...new Set(this.cardLines(card.id).map((l) => l.sku))];
    for (const sku of parts) this.allocate(card.ws, sku, t);
    this.refresh(card, t);
    this.log(card.ws, "job_card", card.id, "confirm_job_card", { code: card.code }, card.confirmedBy, t);
  }

  markArrived(bike: Bike, t: number): void {
    if (bike.status !== "purchased" || t < bike.purchasedAt) throw new SeedError("mark_arrived precondition");
    bike.status = "at_workshop";
    bike.arrivedAt = t;
    this.log(bike.ws, "bike", bike.id, "mark_arrived", {}, userId(bike.ws, "manager"), t);
  }

  startRepair(bike: Bike, t: number): void {
    if (bike.status !== "at_workshop" || t < bike.arrivedAt!) throw new SeedError("start_repair precondition");
    if (!this.bikeCards(bike.id).some((c) => c.status === "confirmed")) throw new SeedError("no confirmed card");
    bike.status = "in_repair";
    bike.bayInAt = t;
    this.log(bike.ws, "bike", bike.id, "start_repair", {}, userId(bike.ws, "manager"), t);
  }

  /** issue_to_job_card: allocate to the line first, then issue from its reservation. */
  issue(line: Line, binCode: string, qty: number, t: number): void {
    const card = this.card(line.cardId);
    const bike = this.bike(card.bikeId);
    if (card.status !== "confirmed" || line.cancelledAt !== null || !["at_workshop", "in_repair"].includes(bike.status)) {
      throw new SeedError(`issue precondition ${card.code}`);
    }
    this.allocate(line.ws, line.sku, t, line.id);
    if (qty > line.qtyReserved) throw new SeedError(`INSUFFICIENT_RESERVATION ${card.code} ${line.sku}`);
    const user = userId(line.ws, "store");
    this.move({ ws: line.ws, sku: line.sku, type: "issue", qty, fromBin: binCode, toBin: null, lineId: line.id, grnLineId: null, ebId: null, reason: null, note: null, userId: user, createdAt: t });
    line.qtyReserved -= qty;
    line.qtyIssued += qty;
    this.checkLine(line);
    this.refresh(card, t);
    this.log(line.ws, "job_card_line", line.id, "issue_to_job_card", { qty, bin: binCode }, user, t);
  }

  /** Issues the whole reservation of every live line, from the bins holding the part. */
  issueAll(card: Card, t: number): void {
    for (const l of this.cardLines(card.id)) {
      if (l.cancelledAt !== null) continue;
      this.allocate(l.ws, l.sku, t, l.id);
      let left = l.qtyReserved;
      for (const b of this.stockBins(l.ws, l.sku, ["normal", "receiving"])) {
        if (left <= 0) break;
        const q = Math.min(left, b.onHand);
        this.issue(l, b.code, q, t);
        left -= q;
      }
    }
  }

  returnWrongFitment(line: Line, qty: number, toBin: string, note: string, t: number): void {
    const card = this.card(line.cardId);
    const bike = this.bike(card.bikeId);
    const net = line.qtyIssued - line.qtyReturned;
    if (card.status !== "confirmed" || qty > net) throw new SeedError("return precondition");
    const user = userId(line.ws, "store");
    this.move({ ws: line.ws, sku: line.sku, type: "return_to_stock", qty, fromBin: null, toBin, lineId: line.id, grnLineId: null, ebId: null, reason: "wrong_fitment", note, userId: user, createdAt: t });
    line.qtyReturned += qty;
    line.qtyRequired = net - qty;
    line.qtyReserved = 0;
    if (bike.variantKey) {
      const k = `${line.sku}|${bike.variantKey}`;
      const f = this.fitments.get(k);
      if (f) {
        f.flagged++;
        f.lastFlagNote = note;
        f.lastFlaggedAt = t;
      } else {
        this.fitments.set(k, { sku: line.sku, variantKey: bike.variantKey, qtyPerBike: 1, source: "learned", confirmed: 0, flagged: 1, lastFlagNote: note, lastFlaggedAt: t, createdAt: t });
      }
    }
    card.needsReview = `wrong_fitment: ${line.sku}`;
    if (line.qtyRequired === 0 && line.qtyIssued - line.qtyReturned === 0) {
      line.cancelledAt = t;
      line.cancelReason = "wrong_fitment";
    }
    this.checkLine(line);
    this.allocate(line.ws, line.sku, t);
    this.refresh(card, t);
    this.log(line.ws, "job_card_line", line.id, "return_from_job_card", { qty, reason: "wrong_fitment", note }, user, t);
  }

  /** add_job_card_line by the manager (clears needs_review_reason). */
  addLine(card: Card, sku: string, qty: number, reason: string | null, t: number): Line {
    if (card.status !== "confirmed") throw new SeedError("JOB_CARD_NOT_CONFIRMED");
    let line = this.liveLine(card.id, sku);
    if (line) line.qtyRequired += qty;
    else line = this.newLine(card, sku, qty, "manual", reason, t);
    card.needsReview = null;
    this.allocate(card.ws, sku, t, line.id);
    this.refresh(card, t);
    this.log(card.ws, "job_card", card.id, "add_job_card_line", { sku, qty }, userId(card.ws, "manager"), t);
    return line;
  }

  closeCard(card: Card, t: number): void {
    const bike = this.bike(card.bikeId);
    if (card.status !== "confirmed" || bike.status !== "in_repair" || t < bike.bayInAt!) throw new SeedError(`close precondition ${card.code}`);
    const open = this.cardLines(card.id).filter((l) => l.cancelledAt === null && (l.qtyReserved > 0 || l.qtyIssued - l.qtyReturned !== l.qtyRequired));
    if (open.length > 0 || card.needsReview !== null) throw new SeedError(`OPEN_LINES ${card.code}`);
    // §9.3 learned fitments.
    if (bike.variantKey) {
      const fitted = new Set(
        this.cardLines(card.id)
          .filter((l) => l.cancelledAt === null && l.qtyIssued - l.qtyReturned > 0 && !PART_BY_SKU.get(l.sku)!.isUniversal)
          .map((l) => l.sku),
      );
      for (const sku of fitted) {
        const k = `${sku}|${bike.variantKey}`;
        const f = this.fitments.get(k);
        if (f) f.confirmed++;
        else this.fitments.set(k, { sku, variantKey: bike.variantKey, qtyPerBike: 1, source: "learned", confirmed: 1, flagged: 0, lastFlagNote: null, lastFlaggedAt: null, createdAt: t });
      }
    }
    card.status = "closed";
    card.closedAt = t;
    card.needsReview = null;
    card.partsCompleteAt ??= t;
    bike.status = "ready";
    bike.readyAt = t;
    // A closed card's lines hold no stock and need none: drop them from the allocation lists.
    for (const l of this.cardLines(card.id)) {
      const k = `${l.ws}|${l.sku}`;
      this.linesBy.set(k, this.linesBy.get(k)!.filter((x) => x !== l));
    }
    this.log(card.ws, "job_card", card.id, "close_job_card", { code: card.code }, userId(card.ws, "manager"), t);
  }

  // -------------------------------------------------------------------------------------------
  // Purchasing.

  /** default_po_price: supplier_parts price ?? last GRN price ?? standard price. */
  defaultPrice(supplier: SupplierKey | null, sku: string): number {
    return (supplier ? this.supplierPrice(supplier, sku) : undefined) ?? this.lastGrnPrice.get(sku)?.price ?? PART_BY_SKU.get(sku)!.pricePaise;
  }

  /** A draft PO created and sent at t (send_po: expected_on = IST date of sent_at + lead). */
  sendPo(key: string, ws: WorkshopCode, supplier: SupplierKey, lines: { sku: string; qty: number }[], t: number): Po {
    const po: Po = {
      id: uid(`po:${key}`), ws, code: this.nextCode(ws, "po"), supplier, status: "sent", sentAt: t,
      expectedOn: dayOf(t) + SUPPLIER_BY_KEY.get(supplier)!.leadTimeDays, createdAt: t,
    };
    this.pos.push(po);
    this.poById.set(po.id, po);
    lines.forEach((l, i) => {
      const pl: PoLine = {
        id: uid(`poline:${key}:${i}`), ws, poId: po.id, sku: l.sku, qtyOrdered: l.qty, qtyAccepted: 0, qtyRejected: 0,
        qtyCancelled: 0, pricePaise: this.defaultPrice(supplier, l.sku), source: "suggested", createdAt: t,
      };
      this.poLines.push(pl);
      this.poLineById.set(pl.id, pl);
      this.poLinesBy.set(`${ws}|${l.sku}`, [...(this.poLinesBy.get(`${ws}|${l.sku}`) ?? []), pl]);
      this.poLinesByPo.set(po.id, [...(this.poLinesByPo.get(po.id) ?? []), pl]);
    });
    this.log(ws, "purchase_order", po.id, "send_po", { code: po.code }, userId(ws, "manager"), t);
    return po;
  }

  poLinesOf(poId: string): PoLine[] {
    return this.poLinesByPo.get(poId) ?? [];
  }

  private refreshPoStatus(po: Po): void {
    const ls = this.poLinesOf(po.id);
    const open = ls.reduce((s, l) => s + l.qtyOrdered - l.qtyAccepted - l.qtyCancelled, 0);
    const acc = ls.reduce((s, l) => s + l.qtyAccepted, 0);
    po.status =
      open === 0 && acc === 0 ? "cancelled"
      : open === 0 && ls.every((l) => l.qtyAccepted === l.qtyOrdered) ? "received"
      : open === 0 ? "closed"
      : acc > 0 ? "partially_received"
      : "sent";
  }

  receiveGrn(
    key: string,
    po: Po,
    lines: { poLineId: string; received: number; damaged?: number; wrong?: number; pricePaise?: number }[],
    invoiceNo: string,
    t: number,
  ): Grn {
    if (po.status !== "sent" && po.status !== "partially_received") throw new SeedError("PO_NOT_RECEIVABLE");
    const user = userId(po.ws, "store");
    const grn: Grn = {
      id: uid(`grn:${key}`), ws: po.ws, code: this.nextCode(po.ws, "grn"), poId: po.id, supplier: po.supplier,
      invoiceNo, invoiceDate: dayOf(t), receivedBy: user, receivedAt: t, createdAt: t,
    };
    this.grns.push(grn);
    const parts: string[] = [];
    lines.forEach((x, i) => {
      if (x.received === 0) return;
      const pl = this.poLineById.get(x.poLineId)!;
      const damaged = x.damaged ?? 0;
      const wrong = x.wrong ?? 0;
      const accepted = x.received - damaged - wrong;
      if (accepted < 0 || accepted > pl.qtyOrdered - pl.qtyAccepted - pl.qtyCancelled) throw new SeedError(`OVER_RECEIPT ${po.code}`);
      const gl: GrnLine = {
        id: uid(`grnline:${key}:${i}`), ws: po.ws, grnId: grn.id, poLineId: pl.id, sku: pl.sku, received: x.received,
        accepted, damaged, wrong, pricePaise: x.pricePaise ?? pl.pricePaise, createdAt: t,
      };
      this.grnLines.push(gl);
      if (accepted > 0) {
        this.move({ ws: po.ws, sku: pl.sku, type: "grn", qty: accepted, fromBin: null, toBin: this.rcv(po.ws), lineId: null, grnLineId: gl.id, ebId: null, reason: null, note: null, userId: user, createdAt: t });
        const prev = this.lastGrnPrice.get(pl.sku);
        if (!prev || prev.at <= t) this.lastGrnPrice.set(pl.sku, { at: t, price: gl.pricePaise });
      }
      pl.qtyAccepted += accepted;
      pl.qtyRejected += damaged + wrong;
      parts.push(pl.sku);
    });
    this.refreshPoStatus(po);
    for (const sku of parts) this.allocate(po.ws, sku, t);
    this.log(po.ws, "grn", grn.id, "receive_grn", { code: grn.code, po_code: po.code }, user, t);
    return grn;
  }

  // -------------------------------------------------------------------------------------------
  // Chronology. Scenarios may be generated out of time order; the RPCs would have numbered
  // documents and ledger rows in time order, so renumber once at the end. Returns old → new code.

  renumber(): Map<string, string> {
    const map = new Map<string, string>();
    const docs: [{ ws: WorkshopCode; code: string; createdAt: number }[], "job_card" | "po" | "grn"][] = [
      [this.cards, "job_card"],
      [this.pos, "po"],
      [this.grns, "grn"],
    ];
    this.counters.clear();
    for (const [list, type] of docs) {
      const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt || (a.code < b.code ? -1 : 1));
      for (const d of sorted) {
        const code = this.nextCode(d.ws, type);
        map.set(d.code, code);
        d.code = code;
      }
    }
    this.moves.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).forEach((m, i) => (m.id = i + 1));
    this.activity.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).forEach((a, i) => {
      a.id = i + 1;
      for (const [k, v] of Object.entries(a.summary)) if (typeof v === "string" && map.has(v)) a.summary[k] = map.get(v);
    });
    return map;
  }

  // -------------------------------------------------------------------------------------------
  // Emergency buys (SPEC §8.3).

  emergencyBuy(
    key: string,
    line: Line,
    qty: number,
    pricePaise: number,
    vendor: string,
    reason: EmergencyBuy["reason"],
    note: string | null,
    t: number,
  ): EmergencyBuy {
    const card = this.card(line.cardId);
    const bike = this.bike(card.bikeId);
    const ok = card.status === "confirmed" && line.cancelledAt === null && ["at_workshop", "in_repair"].includes(bike.status);
    const n = ok ? Math.max(0, Math.min(qty, line.qtyRequired - (line.qtyIssued - line.qtyReturned))) : 0;
    const user = userId(line.ws, "store");
    const eb: EmergencyBuy = {
      id: uid(`eb:${key}`), ws: line.ws, lineId: line.id, sku: line.sku, vendor, qty, pricePaise,
      referencePaise: this.defaultPrice(this.effectiveSupplier(line.ws, line.sku), line.sku),
      qtyIssued: n, qtyToStock: qty - n, reason, note, boughtBy: user, createdAt: t,
    };
    this.emergencyBuys.push(eb);
    const rcv = this.rcv(line.ws);
    this.move({ ws: line.ws, sku: line.sku, type: "emergency_in", qty, fromBin: null, toBin: rcv, lineId: null, grnLineId: null, ebId: eb.id, reason: null, note: null, userId: user, createdAt: t });
    if (n > 0) {
      this.move({ ws: line.ws, sku: line.sku, type: "issue", qty: n, fromBin: rcv, toBin: null, lineId: line.id, grnLineId: null, ebId: eb.id, reason: null, note: null, userId: user, createdAt: t });
      line.qtyIssued += n;
      line.qtyReserved = Math.min(line.qtyReserved, line.qtyRequired - (line.qtyIssued - line.qtyReturned));
      this.checkLine(line);
    }
    this.allocate(line.ws, line.sku, t);
    this.refresh(card, t);
    this.log(line.ws, "emergency_buy", eb.id, "record_emergency_buy", { qty, issued: n, unit_price_paise: pricePaise }, user, t);
    return eb;
  }
}
