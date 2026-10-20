// Demo seed generator (SPEC §15, docs/seed-catalogue.md). Pure and deterministic: one mulberry32
// PRNG with a constant seed, UUIDv5 ids, integer day/minute times, no Date, Math.random or Intl.
// `pnpm seed:gen` writes supabase/seed/template.sql and scripts/seed/planted.json; with --hash it
// only prints the sha256 of both (the determinism test compares runs under different TZ).
//
// Contents: catalogue, master data, bins, opening balances at anchor−180, the 90-day before/after
// simulation (simulate.ts) and the planted scenarios (planted.ts), run together day by day.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  catalogueFitments,
  DEAD_STOCK,
  FINDING_TYPES,
  homeBins,
  fastestMovers,
  jaipurSupplier,
  MODELS,
  normalBins,
  PARTS,
  preferredSupplier,
  reorderSettings,
  secondBin,
  SUPPLIERS,
  supplierParts,
  VARIANTS,
  type ReorderSetting,
  type SupplierKey,
  type WorkshopCode,
} from "./catalogue";
import { effectiveSupplier, Schedule, type Ctx } from "./context";
import { SeedError, uid, userId, World, WS_ID, type Po } from "./engine";
import { planWorkshop, plantedSkus, type Planted, type PlantedWorkshop } from "./planted";
import { SIM_FIRST_DAY, Simulator } from "./simulate";
import { ANCHOR_DATE, at, DAY_START, dateStr, isSunday, OPENING_DAY, tsStr } from "./time";

export type { Planted, PlantedWorkshop } from "./planted";

export const WORKSHOPS: readonly WorkshopCode[] = ["NCR", "JPR"];

/** Copy order (SPEC §15): private.reset_tables() without stock_balances (rebuilt from moves). */
export const SEED_TABLES = [
  "suppliers", "vehicle_models", "model_variants", "parts", "part_fitments", "supplier_parts",
  "finding_types", "finding_type_parts", "bins", "reorder_settings",
  "bikes", "job_cards", "job_card_lines", "inspection_findings",
  "purchase_orders", "po_lines", "grns", "grn_lines", "emergency_buys",
  "stock_moves", "activity_log",
] as const;
export type SeedTable = (typeof SEED_TABLES)[number];

// ---------------------------------------------------------------------------------------------
// PRNG.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// SQL emission.

type Raw = { raw: string };
type Val = string | number | boolean | null | Raw;
type Row = Record<string, Val>;

const raw = (s: string): Raw => ({ raw: s });

function lit(v: Val): string {
  if (v === null) return "null";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new SeedError(`non-integer value ${v}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return v.raw;
  return `'${v.replaceAll("'", "''")}'`;
}

function textArray(xs: string[]): Raw {
  return raw(lit(`{${xs.map((x) => `"${x.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`));
}

const ts = (t: number | null): Val => (t === null ? null : tsStr(t));
const date = (d: number | null): Val => (d === null ? null : dateStr(d));

function insertSql(table: string, rows: Row[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    out.push(
      `INSERT INTO demo_seed.${table} (${cols.join(", ")}) VALUES\n` +
        chunk.map((r) => `(${cols.map((c) => lit(r[c])).join(", ")})`).join(",\n") +
        ";\n",
    );
  }
  return out.join("");
}

export type SeedOutput = { sql: string; planted: Planted; counts: Record<string, number> };

export function generateSeed(): SeedOutput {
  const rng = mulberry32(0x5eed2026);
  const created = at(OPENING_DAY, DAY_START);
  const spPrices = new Map(supplierParts().map((x) => [`${x.supplier}|${x.sku}`, x.pricePaise]));
  const w = new World(catalogueFitments(), (s, sku) => spPrices.get(`${s}|${sku}`), effectiveSupplier, created);

  const settings = { NCR: reorderSettings("NCR"), JPR: reorderSettings("JPR") };
  const homes = { NCR: homeBins("NCR"), JPR: homeBins("JPR") };

  // Bins.
  for (const ws of WORKSHOPS) {
    for (const codes of Object.values(normalBins(ws))) for (const code of codes) w.addBin(ws, code, "normal", created);
    w.addBin(ws, `${ws}-RCV`, "receiving", created);
    w.addBin(ws, `${ws}-QRN`, "quarantine", created);
  }

  // Opening balances at anchor−180 (adjust_in, reason 'opening_balance').
  for (const ws of WORKSHOPS) {
    const fast = new Set(fastestMovers(ws));
    const manager = userId(ws, "manager");
    for (const part of PARTS) {
      const s = settings[ws].get(part.sku)!;
      if (!s.auto) continue;
      const home = homes[ws].get(part.sku)!;
      if (fast.has(part.sku)) {
        const half = Math.floor(s.maxQty / 2);
        w.adjustIn(ws, home, part.sku, s.maxQty - half, "opening_balance", manager, created);
        w.adjustIn(ws, secondBin(ws, part.sku), part.sku, half, "opening_balance", manager, created);
      } else {
        w.adjustIn(ws, home, part.sku, s.maxQty, "opening_balance", manager, created);
      }
    }
    for (const [sku, qty] of DEAD_STOCK[ws]) {
      if (settings[ws].get(sku)!.auto) throw new SeedError(`dead-stock SKU ${sku} is an auto part`);
      w.adjustIn(ws, homes[ws].get(sku)!, sku, qty, "opening_balance", manager, created);
    }
  }

  // Planted scenarios and the 90-day simulation, run day by day in time order.
  const schedule = new Schedule();
  const regSeq = { n: 0 };
  const planted = { template_anchor_date: ANCHOR_DATE } as Planted;
  const sims: Simulator[] = [];
  for (const ws of WORKSHOPS) {
    const ctx: Ctx = { w, rng, ws, settings: settings[ws], home: homes[ws], regSeq, schedule };
    sims.push(new Simulator(ctx, plantedSkus(ws)));
    planted[ws] = planWorkshop(ctx);
  }
  for (let day = SIM_FIRST_DAY; day <= -1; day++) {
    if (isSunday(day)) continue;
    for (const sim of sims) sim.scheduleDay(day);
  }
  for (let day = SIM_FIRST_DAY; day <= -1; day++) {
    for (const step of schedule.take(day).sort((a, b) => a.t - b.t || a.seq - b.seq)) step.run();
  }
  if (schedule.pendingDays().length > 0) throw new SeedError(`steps outside the simulated days: ${schedule.pendingDays().join(",")}`);
  checkInvariants(w);
  const codes = w.renumber();
  const remap = (v: unknown): unknown =>
    typeof v === "string" ? (codes.get(v) ?? v)
    : Array.isArray(v) ? v.map(remap)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]))
    : v;
  for (const ws of WORKSHOPS) planted[ws] = remap(planted[ws]) as PlantedWorkshop;

  // Rows.
  const tables = buildRows(w, settings, created);
  const counts: Record<string, number> = {};
  let sql =
    "-- Generated by `pnpm seed:gen` (scripts/seed/generate.ts). Do not edit.\n" +
    "DROP SCHEMA IF EXISTS demo_seed CASCADE;\nCREATE SCHEMA demo_seed;\n";
  for (const tbl of SEED_TABLES) sql += `CREATE TABLE demo_seed.${tbl} (LIKE public.${tbl} INCLUDING DEFAULTS);\n`;
  sql += "CREATE TABLE demo_seed.meta (anchor_date date NOT NULL);\n";
  sql += `INSERT INTO demo_seed.meta (anchor_date) VALUES ('${ANCHOR_DATE}');\n`;
  for (const tbl of SEED_TABLES) {
    counts[tbl] = tables[tbl].length;
    sql += insertSql(tbl, tables[tbl]);
  }
  counts.meta = 1;
  return { sql, planted, counts };
}

/** Cheap in-generator mirror of check_invariants items 3–5 (the SQL check runs at reset). */
function checkInvariants(w: World): void {
  const keys = new Set(w.lines.map((l) => `${l.ws}|${l.sku}`));
  for (const k of keys) {
    const [ws, sku] = k.split("|") as [WorkshopCode, string];
    const reserved = w.reserved(ws, sku);
    if (reserved > w.usable(ws, sku)) throw new SeedError(`reserved > usable for ${k}`);
    const short = w.lines.some((l) => l.ws === ws && l.sku === sku && l.cancelledAt === null && w.card(l.cardId).status === "confirmed" && World.uncovered(l) > 0);
    if (w.available(ws, sku) > 0 && short) throw new SeedError(`free stock while short for ${k}`);
  }
}

function buildRows(w: World, settings: Record<WorkshopCode, Map<string, ReorderSetting>>, created: number): Record<SeedTable, Row[]> {
  const sid = (k: SupplierKey | null) => (k ? uid(`supplier:${k}`) : null);
  const pid = (sku: string) => uid(`part:${sku}`);
  const vid = (k: string) => uid(`variant:${k}`);
  const bid = (code: string | null) => (code ? w.bins.get(code)!.id : null);
  const createdTs = ts(created);

  const out = {} as Record<SeedTable, Row[]>;
  out.suppliers = SUPPLIERS.map((s) => ({ id: sid(s.key), name: s.name, city: s.city, phone: s.phone, kind: s.kind, lead_time_days: s.leadTimeDays, is_active: true, created_at: createdTs }));
  out.vehicle_models = MODELS.map((m) => ({ id: uid(`model:${m.key}`), make: m.make, model: m.model, segment: m.segment, created_at: createdTs }));
  out.model_variants = VARIANTS.map((v) => ({
    id: vid(v.key), model_id: uid(`model:${v.modelKey}`), name: v.name, year_from: v.yearFrom, year_to: v.yearTo,
    brake_front: v.brakeFront, brake_rear: v.brakeRear, start_type: v.startType, wheels: v.wheels, emission: v.emission, fuel: v.fuel, created_at: createdTs,
  }));
  out.parts = PARTS.map((p) => ({
    id: pid(p.sku), sku: p.sku, name: p.name, name_hi: p.nameHi, aliases: textArray(p.aliases), oem_part_no: p.oemPartNo,
    category: p.category, part_type: p.partType, uom: p.uom, standard_price_paise: p.pricePaise,
    preferred_supplier_id: sid(preferredSupplier(p)), is_universal: p.isUniversal, is_active: true, created_at: createdTs,
  }));
  out.part_fitments = [...w.fitments.values()]
    .sort((a, b) => (a.sku + a.variantKey < b.sku + b.variantKey ? -1 : 1))
    .map((f) => ({
      part_id: pid(f.sku), variant_id: vid(f.variantKey), qty_per_bike: f.qtyPerBike, source: f.source,
      confirmed_count: f.confirmed, flagged_count: f.flagged, last_flag_note: f.lastFlagNote, last_flagged_at: ts(f.lastFlaggedAt), created_at: ts(f.createdAt),
    }));
  out.supplier_parts = supplierParts().map((x) => ({ supplier_id: sid(x.supplier), part_id: pid(x.sku), supplier_code: x.supplierCode, price_paise: x.pricePaise, created_at: createdTs }));
  out.finding_types = FINDING_TYPES.map((f) => ({ id: uid(`finding_type:${f.code}`), code: f.code, label_en: f.labelEn, label_hi: f.labelHi, area: f.area, is_active: true, created_at: createdTs }));
  out.finding_type_parts = FINDING_TYPES.flatMap((f) =>
    f.mappings.map((m, i) => ({ id: uid(`ftp:${f.code}:${i}`), finding_type_id: uid(`finding_type:${f.code}`), part_type: m.partType, qty: m.qty, attr_key: m.attrKey, attr_value: m.attrValue, created_at: createdTs })),
  );
  out.bins = [...w.bins.values()].map((b) => ({ id: b.id, workshop_id: WS_ID[b.ws], code: b.code, kind: b.kind, is_active: true, count_requested_at: null, created_at: ts(b.createdAt) }));
  out.reorder_settings = WORKSHOPS.flatMap((ws) =>
    PARTS.map((p) => {
      const s = settings[ws].get(p.sku)!;
      return { workshop_id: WS_ID[ws], part_id: pid(p.sku), auto: s.auto, safety_stock: s.safetyStock, max_qty: s.maxQty, preferred_supplier_id: ws === "JPR" ? sid(jaipurSupplier(p)) : null, created_at: createdTs };
    }),
  );

  out.bikes = w.bikes.map((b) => ({
    id: b.id, workshop_id: WS_ID[b.ws], reg_no: b.regNo, model_id: uid(`model:${b.modelKey}`), variant_id: b.variantKey ? vid(b.variantKey) : null,
    mfg_year: b.mfgYear, status: b.status, purchased_at: ts(b.purchasedAt), arrived_at: ts(b.arrivedAt), bay_in_at: ts(b.bayInAt),
    ready_at: ts(b.readyAt), cancelled_at: null, cancel_reason: null, is_simulated: true, created_at: ts(b.createdAt),
  }));
  out.job_cards = w.cards.map((c) => ({
    id: c.id, workshop_id: WS_ID[c.ws], code: c.code, bike_id: c.bikeId, status: c.status, needed_by: date(c.neededBy), needs_review_reason: c.needsReview,
    confirmed_at: ts(c.confirmedAt), confirmed_by: c.confirmedBy, parts_complete_at: ts(c.partsCompleteAt), closed_at: ts(c.closedAt),
    cancelled_at: null, cancel_reason: null, is_simulated: true, created_at: ts(c.createdAt),
  }));
  out.job_card_lines = w.lines.map((l) => ({
    id: l.id, workshop_id: WS_ID[l.ws], job_card_id: l.cardId, part_id: pid(l.sku), qty_required: l.qtyRequired, qty_reserved: l.qtyReserved,
    qty_issued: l.qtyIssued, qty_returned: l.qtyReturned, source: l.source, added_reason: l.addedReason, cancelled_at: ts(l.cancelledAt),
    cancel_reason: l.cancelReason, created_at: ts(l.createdAt),
  }));
  out.inspection_findings = w.findings.map((f) => ({
    id: f.id, workshop_id: WS_ID[f.ws], bike_id: f.bikeId, finding_type_id: uid(`finding_type:${f.code}`), qty: null, notes: null,
    job_card_line_id: f.lineId, no_part_reason: null, created_at: ts(f.createdAt),
  }));
  out.purchase_orders = w.pos.map((p: Po) => ({
    id: p.id, workshop_id: WS_ID[p.ws], code: p.code, supplier_id: sid(p.supplier), status: p.status, sent_at: ts(p.sentAt),
    expected_on: date(p.expectedOn), cancel_reason: null, is_simulated: true, created_at: ts(p.createdAt),
  }));
  out.po_lines = w.poLines.map((l) => ({
    id: l.id, workshop_id: WS_ID[l.ws], po_id: l.poId, part_id: pid(l.sku), qty_ordered: l.qtyOrdered, qty_accepted: l.qtyAccepted,
    qty_rejected: l.qtyRejected, qty_cancelled: l.qtyCancelled, unit_price_paise: l.pricePaise, source: l.source, created_at: ts(l.createdAt),
  }));
  out.grns = w.grns.map((g) => ({
    id: g.id, workshop_id: WS_ID[g.ws], code: g.code, po_id: g.poId, supplier_id: sid(g.supplier), supplier_invoice_no: g.invoiceNo,
    invoice_date: date(g.invoiceDate), received_by: g.receivedBy, received_at: ts(g.receivedAt), is_simulated: true, created_at: ts(g.createdAt),
  }));
  out.grn_lines = w.grnLines.map((g) => ({
    id: g.id, workshop_id: WS_ID[g.ws], grn_id: g.grnId, po_line_id: g.poLineId, part_id: pid(g.sku), qty_received: g.received,
    qty_accepted: g.accepted, qty_damaged: g.damaged, qty_wrong_part: g.wrong, unit_price_paise: g.pricePaise, created_at: ts(g.createdAt),
  }));
  out.emergency_buys = w.emergencyBuys.map((e) => ({
    id: e.id, workshop_id: WS_ID[e.ws], job_card_line_id: e.lineId, part_id: pid(e.sku), vendor_name: e.vendor, qty: e.qty,
    unit_price_paise: e.pricePaise, reference_price_paise: e.referencePaise, qty_issued: e.qtyIssued, qty_to_stock: e.qtyToStock,
    reason: e.reason, note: e.note, bill_photo_path: null, bought_by: e.boughtBy, is_simulated: true, created_at: ts(e.createdAt),
  }));
  out.stock_moves = w.moves.map((m) => ({
    id: m.id, workshop_id: WS_ID[m.ws], part_id: pid(m.sku), move_type: m.type, qty: m.qty, from_bin_id: bid(m.fromBin), to_bin_id: bid(m.toBin),
    job_card_line_id: m.lineId, grn_line_id: m.grnLineId, emergency_buy_id: m.ebId, reason: m.reason, note: m.note, user_id: m.userId,
    request_id: null, is_simulated: true, created_at: ts(m.createdAt),
  }));
  out.activity_log = w.activity.map((a) => ({
    id: a.id, workshop_id: a.ws ? WS_ID[a.ws] : null, entity_type: a.entityType, entity_id: a.entityId, action: a.action,
    summary: JSON.stringify(a.summary), user_id: a.userId, request_id: null, is_simulated: true, created_at: ts(a.createdAt),
  }));
  return out;
}

// ---------------------------------------------------------------------------------------------
// CLI.

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { sql, planted, counts } = generateSeed();
  if (process.argv.includes("--hash")) {
    console.log(createHash("sha256").update(sql).update(JSON.stringify(planted)).digest("hex"));
    process.exit(0);
  }
  writeFileSync(new URL("../../supabase/seed/template.sql", import.meta.url), sql);
  writeFileSync(new URL("./planted.json", import.meta.url), JSON.stringify(planted, null, 2) + "\n");
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`template.sql: ${total} rows (anchor ${ANCHOR_DATE})`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);
}
