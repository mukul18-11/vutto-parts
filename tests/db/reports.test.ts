// Reports and metrics (SPEC §10): part wait, dead stock, emergency share and premium, IST day
// bucketing, blocked bikes board, inbound shortfalls, stock ledger, and workshop scoping.
// History is inserted as postgres with explicit timestamps after test_clear, and functions are
// called with an explicit p_as_of, so nothing depends on the wall clock (SPEC §17).
import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { clientAs, pgClient, type Client } from "./clients";
import { DEMO_USERS, WORKSHOP_IDS } from "./demo-users";
import { CAT, insertBins, insertCatalog, testClear, wsIds, type WorkshopCode } from "./fixtures";
import { expectInvariantsHold } from "./invariants";

const NCR = WORKSHOP_IDS.NCR;
const JPR = WORKSHOP_IDS.JPR;
const BINS = { NCR: wsIds("NCR"), JPR: wsIds("JPR") };
const userId = (key: string) => DEMO_USERS.find((u) => u.key === key)!.id;
const MANAGER = { NCR: userId("ncr_manager"), JPR: userId("jpr_manager") };
const STORE = { NCR: userId("ncr_store"), JPR: userId("jpr_store") };
const n = (i: number) => `e1000000-0000-0000-0000-${String(i).padStart(12, "0")}`;

/** An IST wall-clock instant, e.g. ist("2025-10-15", "10:00"). */
const ist = (day: string, time: string) => `${day}T${time}:00+05:30`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

let db: pg.Client;
let admin: Client;
let ncrManager: Client;
let jprManager: Client;
let seq = 0;
const code = (prefix: string, ws: WorkshopCode) => `${prefix}-${ws}-${String(++seq).padStart(6, "0")}`;

beforeAll(async () => {
  db = await pgClient();
  admin = await clientAs("admin");
  ncrManager = await clientAs("ncr_manager");
  jprManager = await clientAs("jpr_manager");
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

// ---------------------------------------------------------------------------------------------
// Fixture helpers (as postgres; triggers run, RLS does not).

async function fresh() {
  await testClear(db);
  await insertCatalog(db);
  await insertBins(db, "NCR");
  await insertBins(db, "JPR");
}

async function part(id: string, sku: string, opts: { price?: number; supplier?: string | null } = {}) {
  await db.query(
    `insert into public.parts (id, sku, name, category, part_type, uom, standard_price_paise, preferred_supplier_id)
     values ($1, $2, 'Part ' || $2::text, 'wear', 'test_part', 'pcs', $3, $4)`,
    [id, sku, opts.price ?? 10000, opts.supplier ?? null],
  );
}

type BikeOpts = {
  id: string;
  ws: WorkshopCode;
  reg: string;
  status?: "purchased" | "at_workshop" | "in_repair";
  purchasedAt: string;
  arrivedAt?: string | null;
  bayInAt?: string | null;
};

async function bike(o: BikeOpts) {
  await db.query(
    `insert into public.bikes
       (id, workshop_id, reg_no, model_id, variant_id, mfg_year, status, purchased_at, arrived_at, bay_in_at)
     values ($1, $2, $3, $4, $5, 2021, $6, $7, $8, $9)`,
    [
      o.id,
      WORKSHOP_IDS[o.ws],
      o.reg,
      CAT.model,
      CAT.variant,
      o.status ?? "at_workshop",
      o.purchasedAt,
      o.arrivedAt ?? null,
      o.bayInAt ?? null,
    ],
  );
}

type CardOpts = {
  id: string;
  ws: WorkshopCode;
  bike: string;
  status?: "confirmed" | "closed" | "cancelled";
  confirmedAt: string;
  completeAt?: string | null;
  closedAt?: string | null;
  cancelledAt?: string | null;
  needsReview?: string | null;
};

/** A confirmed (or closed/cancelled) card. Returns its code. */
async function card(o: CardOpts): Promise<string> {
  const c = code("JC", o.ws);
  await db.query(
    `insert into public.job_cards
       (id, workshop_id, code, bike_id, status, confirmed_at, confirmed_by, parts_complete_at, closed_at,
        cancelled_at, needs_review_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      o.id,
      WORKSHOP_IDS[o.ws],
      c,
      o.bike,
      o.status ?? "confirmed",
      o.confirmedAt,
      MANAGER[o.ws],
      o.completeAt ?? null,
      o.closedAt ?? null,
      o.cancelledAt ?? null,
      o.needsReview ?? null,
    ],
  );
  return c;
}

type LineOpts = {
  id: string;
  ws: WorkshopCode;
  card: string;
  part: string;
  required: number;
  reserved?: number;
  issued?: number;
  returned?: number;
};

async function line(o: LineOpts) {
  await db.query(
    `insert into public.job_card_lines
       (id, workshop_id, job_card_id, part_id, qty_required, qty_reserved, qty_issued, qty_returned, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'suggested')`,
    [o.id, WORKSHOP_IDS[o.ws], o.card, o.part, o.required, o.reserved ?? 0, o.issued ?? 0, o.returned ?? 0],
  );
}

type MoveOpts = {
  ws: WorkshopCode;
  part: string;
  type: string;
  qty: number;
  from?: string | null;
  to?: string | null;
  at?: string;
  line?: string;
  grnLine?: string;
  buy?: string;
  reason?: string;
  user?: string;
};

async function move(o: MoveOpts) {
  await db.query(
    `insert into public.stock_moves
       (workshop_id, part_id, move_type, qty, from_bin_id, to_bin_id, job_card_line_id, grn_line_id,
        emergency_buy_id, reason, user_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12::timestamptz, now()))`,
    [
      WORKSHOP_IDS[o.ws],
      o.part,
      o.type,
      o.qty,
      o.from ?? null,
      o.to ?? null,
      o.line ?? null,
      o.grnLine ?? null,
      o.buy ?? null,
      o.reason ?? null,
      o.user ?? MANAGER[o.ws],
      o.at ?? null,
    ],
  );
}

/** Old stock: adjust_in into a bin (normal by default). */
const stockIn = (ws: WorkshopCode, part: string, qty: number, at?: string, bin?: string) =>
  move({ ws, part, type: "adjust_in", qty, to: bin ?? BINS[ws].normal, at, reason: "opening_balance" });

/** A closed PO with one GRN line received at `at` into receiving. Returns the codes. */
async function grn(o: { ws: WorkshopCode; part: string; accepted: number; damaged?: number; price: number; at: string }) {
  const w = WORKSHOP_IDS[o.ws];
  const damaged = o.damaged ?? 0;
  const [poId, poLineId, grnId, grnLineId] = [uuidv4(), uuidv4(), uuidv4(), uuidv4()];
  const poCode = code("PO", o.ws);
  const grnCode = code("GRN", o.ws);
  await db.query(
    `insert into public.purchase_orders (id, workshop_id, code, supplier_id, status, sent_at, expected_on)
     values ($1, $2, $3, $4, 'closed', $5, private.ist_date($5))`,
    [poId, w, poCode, CAT.supplier, o.at],
  );
  await db.query(
    `insert into public.po_lines
       (id, workshop_id, po_id, part_id, qty_ordered, qty_accepted, qty_rejected, qty_cancelled, unit_price_paise, source)
     values ($1, $2, $3, $4, $5, $6, $7, $7, $8, 'suggested')`,
    [poLineId, w, poId, o.part, o.accepted + damaged, o.accepted, damaged, o.price],
  );
  await db.query(
    `insert into public.grns (id, workshop_id, code, po_id, supplier_id, supplier_invoice_no, invoice_date, received_by, received_at)
     values ($1, $2, $3, $4, $5, $3, private.ist_date($6), $7, $6)`,
    [grnId, w, grnCode, poId, CAT.supplier, o.at, STORE[o.ws]],
  );
  await db.query(
    `insert into public.grn_lines
       (id, workshop_id, grn_id, po_line_id, part_id, qty_received, qty_accepted, qty_damaged, unit_price_paise)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [grnLineId, w, grnId, poLineId, o.part, o.accepted + damaged, o.accepted, damaged, o.price],
  );
  if (o.accepted > 0) {
    await move({
      ws: o.ws, part: o.part, type: "grn", qty: o.accepted, to: BINS[o.ws].rcv, at: o.at,
      grnLine: grnLineId, user: STORE[o.ws],
    });
  }
  return { poCode, grnCode, grnLineId };
}

/** A sent PO for one part, expected `inDays` from IST today (negative = overdue). */
async function sentPo(ws: WorkshopCode, partId: string, qty: number, inDays: number): Promise<string> {
  const w = WORKSHOP_IDS[ws];
  const poId = uuidv4();
  const poCode = code("PO", ws);
  await db.query(
    `insert into public.purchase_orders (id, workshop_id, code, supplier_id, status, sent_at, expected_on)
     values ($1, $2, $3, $4, 'sent', now(), private.ist_today() + $5::int)`,
    [poId, w, poCode, CAT.supplier, inDays],
  );
  await db.query(
    `insert into public.po_lines (workshop_id, po_id, part_id, qty_ordered, unit_price_paise, source)
     values ($1, $2, $3, $4, 10000, 'suggested')`,
    [w, poId, partId, qty],
  );
  return poCode;
}

/** An emergency buy whose units all went to stock (emergency_in into receiving). */
async function buy(o: {
  id: string; ws: WorkshopCode; line: string; part: string; qty: number; price: number; ref: number | null; at: string;
}) {
  await db.query(
    `insert into public.emergency_buys
       (id, workshop_id, job_card_line_id, part_id, vendor_name, qty, unit_price_paise, reference_price_paise,
        qty_issued, qty_to_stock, reason, bought_by, created_at)
     values ($1, $2, $3, $4, 'Local shop', $5, $6, $7, 0, $5, 'no_stock', $8, $9)`,
    [o.id, WORKSHOP_IDS[o.ws], o.line, o.part, o.qty, o.price, o.ref, STORE[o.ws], o.at],
  );
  await move({
    ws: o.ws, part: o.part, type: "emergency_in", qty: o.qty, to: BINS[o.ws].rcv, at: o.at, buy: o.id,
    user: STORE[o.ws],
  });
}

// ---------------------------------------------------------------------------------------------
// Client calls.

type Row = Record<string, unknown>;

async function call<T = Row>(c: Client, fn: string, args: Row): Promise<T[]> {
  const { data, error } = await c.rpc(fn as never, args as never);
  expect(error, JSON.stringify(error)).toBeNull();
  return data as unknown as T[];
}

async function kpis(c: Client, ws: string | null, from: string, to: string, asOf?: string): Promise<Row> {
  const rows = await call(c, "kpis", {
    p_workshop_id: ws, p_from: from, p_to: to, ...(asOf ? { p_as_of: asOf } : {}),
  });
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function view<T = Row>(c: Client, name: string): Promise<T[]> {
  const { data, error } = await c.from(name as never).select("*");
  expect(error, JSON.stringify(error)).toBeNull();
  return data as unknown as T[];
}

const num = (v: unknown) => (v === null ? null : Number(v));
const workshopsOf = (rows: Row[]) => [...new Set(rows.map((r) => r.workshop_id))].sort();

// ---------------------------------------------------------------------------------------------

describe("part wait (test 1)", () => {
  const AS_OF = "2025-10-20";
  const B = { a: n(1), b: n(2), c: n(3), d: n(4), e: n(5), f: n(6), g: n(7), h: n(8), i: n(9) };
  const C = { a: n(11), b: n(12), c: n(13), d: n(14), e: n(15), f: n(16), g: n(17), h: n(18), i: n(19) };
  const PART_X = n(20);

  beforeAll(async () => {
    await fresh();
    await part(PART_X, "PW-X");
    const arrived = (id: string, reg: string, at: string) =>
      bike({ id, ws: "NCR", reg, purchasedAt: ist("2025-09-01", "10:00"), arrivedAt: at });

    // A: reserved before arrival -> wait 0.
    await arrived(B.a, "DL1 PW 0001", ist("2025-10-15", "10:00"));
    await card({ id: C.a, ws: "NCR", bike: B.a, confirmedAt: ist("2025-10-14", "10:00"), completeAt: ist("2025-10-14", "12:00") });
    // B: blocked 30 hours after arrival, then covered.
    await arrived(B.b, "DL1 PW 0002", ist("2025-10-15", "10:00"));
    await card({ id: C.b, ws: "NCR", bike: B.b, confirmedAt: ist("2025-10-15", "09:00"), completeAt: ist("2025-10-16", "16:00") });
    // C: still blocked; as of 20 Oct the wait so far runs to midnight IST: 36 hours.
    await arrived(B.c, "DL1 PW 0003", ist("2025-10-19", "12:00"));
    await card({ id: C.c, ws: "NCR", bike: B.c, confirmedAt: ist("2025-10-18", "10:00") });
    await line({ id: n(30), ws: "NCR", card: C.c, part: PART_X, required: 1 });
    // D: 10 hours. E: confirmed after arrival, start = confirmation, 4 hours.
    await arrived(B.d, "DL1 PW 0004", ist("2025-10-16", "10:00"));
    await card({ id: C.d, ws: "NCR", bike: B.d, confirmedAt: ist("2025-10-16", "08:00"), completeAt: ist("2025-10-16", "20:00") });
    await arrived(B.e, "DL1 PW 0005", ist("2025-10-17", "08:00"));
    await card({ id: C.e, ws: "NCR", bike: B.e, confirmedAt: ist("2025-10-17", "10:00"), completeAt: ist("2025-10-17", "14:00") });

    // Excluded: F never arrived; G's card was cancelled; H started before the range.
    await bike({ id: B.f, ws: "NCR", reg: "DL1 PW 0006", status: "purchased", purchasedAt: ist("2025-10-15", "10:00") });
    await card({ id: C.f, ws: "NCR", bike: B.f, confirmedAt: ist("2025-10-15", "10:00"), completeAt: ist("2025-10-15", "11:00") });
    await arrived(B.g, "DL1 PW 0007", ist("2025-10-16", "10:00"));
    await card({
      id: C.g, ws: "NCR", bike: B.g, status: "cancelled", confirmedAt: ist("2025-10-16", "10:00"),
      cancelledAt: ist("2025-10-16", "12:00"),
    });
    await arrived(B.h, "DL1 PW 0008", ist("2025-09-20", "10:00"));
    await card({ id: C.h, ws: "NCR", bike: B.h, confirmedAt: ist("2025-09-20", "10:00"), completeAt: ist("2025-09-21", "10:00") });

    // I: started 20 Oct 08:00, completed 22 Oct 10:00 (after the 20 Oct cutoff).
    await arrived(B.i, "DL1 PW 0009", ist("2025-10-20", "08:00"));
    await card({ id: C.i, ws: "NCR", bike: B.i, confirmedAt: ist("2025-10-19", "08:00"), completeAt: ist("2025-10-22", "10:00") });
  });

  it("measures each bike: 0 when reserved before arrival, 30 h, and a blocked bike's wait so far", async () => {
    const rows = await call(ncrManager, "part_waits", {
      p_workshop_id: NCR, p_from: "2025-10-01", p_to: "2025-10-19", p_as_of: AS_OF,
    });
    const byCard = Object.fromEntries(rows.map((r) => [r.job_card_id, r]));
    expect(Object.keys(byCard).sort()).toEqual([C.a, C.b, C.c, C.d, C.e].sort());
    expect(num(byCard[C.a].wait_hours)).toBe(0);
    expect(num(byCard[C.b].wait_hours)).toBe(30);
    expect(num(byCard[C.c].wait_hours)).toBe(36);
    expect(byCard[C.c].still_waiting).toBe(true);
    expect(num(byCard[C.d].wait_hours)).toBe(10);
    expect(num(byCard[C.e].wait_hours)).toBe(4);
    expect(rows.filter((r) => r.still_waiting)).toHaveLength(1);
  });

  it("pools the stats over all n, including the still-waiting bike", async () => {
    const k = await kpis(ncrManager, NCR, "2025-10-01", "2025-10-19", AS_OF);
    expect(k.wait_n).toBe(5);
    expect(k.wait_completed_n).toBe(4);
    expect(k.wait_still_waiting_n).toBe(1);
    expect(num(k.wait_still_waiting_avg_hours)).toBe(36);
    expect(num(k.wait_zero_pct)).toBeCloseTo(0.2, 10);
    // Waits 0, 4, 10, 30, 36: median 10; p90 = 30 + 0.6 x 6 (percentile_cont).
    expect(num(k.wait_median_hours)).toBe(10);
    expect(num(k.wait_p90_hours)).toBeCloseTo(33.6, 10);
  });

  it("counts a bike completed after the as_of cutoff as still waiting", async () => {
    const asOf20 = await call(ncrManager, "part_waits", {
      p_workshop_id: NCR, p_from: "2025-10-20", p_to: "2025-10-20", p_as_of: "2025-10-20",
    });
    expect(asOf20).toHaveLength(1);
    expect(asOf20[0].still_waiting).toBe(true);
    expect(num(asOf20[0].wait_hours)).toBe(16);

    const asOf22 = await call(ncrManager, "part_waits", {
      p_workshop_id: NCR, p_from: "2025-10-20", p_to: "2025-10-20", p_as_of: "2025-10-22",
    });
    expect(asOf22[0].still_waiting).toBe(false);
    expect(num(asOf22[0].wait_hours)).toBe(50);
  });

  it("returns n with null median, p90 and zero share when n < 5", async () => {
    const k = await kpis(ncrManager, NCR, "2025-10-15", "2025-10-16", AS_OF);
    expect(k.wait_n).toBe(3);
    expect(k.wait_median_hours).toBeNull();
    expect(k.wait_p90_hours).toBeNull();
    expect(k.wait_zero_pct).toBeNull();
  });
});

describe("part wait after a reallocation (test 1)", () => {
  const PART_R = n(40);
  const X = { bike: n(41), card: n(42), line: n(43) };
  const Y = { bike: n(44), card: n(45), line: n(46) };

  beforeAll(async () => {
    await fresh();
    await part(PART_R, "PW-R");
    await stockIn("NCR", PART_R, 1, daysAgo(10));
    // X arrived 3 days ago and was first complete 2 days ago (a 24-hour wait at that point).
    await bike({ id: X.bike, ws: "NCR", reg: "DL1 RA 0001", purchasedAt: daysAgo(5), arrivedAt: daysAgo(3) });
    await card({ id: X.card, ws: "NCR", bike: X.bike, confirmedAt: daysAgo(4), completeAt: daysAgo(2) });
    await line({ id: X.line, ws: "NCR", card: X.card, part: PART_R, required: 1, reserved: 1 });
    await bike({ id: Y.bike, ws: "NCR", reg: "DL1 RA 0002", purchasedAt: daysAgo(2), arrivedAt: daysAgo(1) });
    await card({ id: Y.card, ws: "NCR", bike: Y.bike, confirmedAt: daysAgo(1) });
    await line({ id: Y.line, ws: "NCR", card: Y.card, part: PART_R, required: 1 });
  });

  it("uses the final completion time when a card goes incomplete and complete again", async () => {
    const realloc = await ncrManager.rpc("reallocate_reservation", {
      p_request_id: uuidv4(), p_from_line_id: X.line, p_to_line_id: Y.line, p_qty: 1, p_reason: "Y is in the bay first",
    });
    expect(realloc.error, JSON.stringify(realloc.error)).toBeNull();
    const mid = await db.query(`select parts_complete_at from public.job_cards where id = $1`, [X.card]);
    expect(mid.rows[0].parts_complete_at).toBeNull();

    const adjust = await ncrManager.rpc("adjust_stock", {
      p_request_id: uuidv4(), p_bin_id: BINS.NCR.normal, p_part_id: PART_R, p_counted_qty: 2, p_expected_on_hand: 1,
      p_reason: "found",
    });
    expect(adjust.error, JSON.stringify(adjust.error)).toBeNull();

    const expected = await db.query<{ hours: string; from: string; to: string }>(
      `select (extract(epoch from c.parts_complete_at - greatest(b.arrived_at, c.confirmed_at)) / 3600)::text as hours,
         (private.ist_date(b.arrived_at) - 1)::text as from, private.ist_today()::text as to
       from public.job_cards c join public.bikes b on b.id = c.bike_id where c.id = $1`,
      [X.card],
    );
    const { hours, from, to } = expected.rows[0];
    const rows = await call(ncrManager, "part_waits", { p_workshop_id: NCR, p_from: from, p_to: to });
    const x = rows.find((r) => r.job_card_id === X.card)!;
    expect(x.still_waiting).toBe(false);
    expect(num(x.wait_hours)).toBeCloseTo(Number(hours), 6);
    expect(num(x.wait_hours)).toBeGreaterThan(70); // not the first completion's 24 hours
  });
});

describe("dead stock (test 2)", () => {
  const AS_OF = "2025-10-20";
  const P = { opening: n(51), grnRecent: n(52), reserved: n(53), issued: n(54), aged: n(55), qrn: n(56), std: n(57) };

  beforeAll(async () => {
    await fresh();
    await part(P.opening, "DS-OPEN", { supplier: CAT.supplier });
    await db.query(`insert into public.supplier_parts (supplier_id, part_id, price_paise) values ($1, $2, 7000)`, [
      CAT.supplier, P.opening,
    ]);
    await part(P.grnRecent, "DS-GRN");
    await part(P.reserved, "DS-RES");
    await part(P.issued, "DS-ISS");
    await part(P.aged, "DS-AGED");
    await part(P.qrn, "DS-QRN");
    await part(P.std, "DS-STD", { price: 4321 });

    // Opening stock 120 days before as_of, never issued: dead at the supplier price.
    await stockIn("NCR", P.opening, 5, ist("2025-06-22", "10:00"));
    // GRN 20 days ago: not dead.
    await grn({ ws: "NCR", part: P.grnRecent, accepted: 2, price: 9000, at: ist("2025-09-30", "11:00") });
    // 3 old units (GRN at 12345), 1 reserved for a waiting bike: dead_qty 2.
    await grn({ ws: "NCR", part: P.reserved, accepted: 3, price: 12345, at: ist("2025-06-01", "11:00") });
    // Old stock, 1 issued 10 days ago: not dead.
    await stockIn("NCR", P.issued, 4, ist("2025-06-01", "10:00"));
    // Old GRN; putaway and an adjust_in inside the window do not reset the age.
    await grn({ ws: "NCR", part: P.aged, accepted: 3, price: 5000, at: ist("2025-06-01", "11:00") });
    await move({ ws: "NCR", part: P.aged, type: "putaway", qty: 2, from: BINS.NCR.rcv, to: BINS.NCR.normal, at: ist("2025-10-15", "10:00") });
    await move({ ws: "NCR", part: P.aged, type: "adjust_in", qty: 1, to: BINS.NCR.normal, at: ist("2025-10-18", "10:00"), reason: "found" });
    // Quarantine only: listed separately, never dead stock.
    await stockIn("NCR", P.qrn, 2, ist("2025-06-01", "10:00"), BINS.NCR.qrn);
    // No GRN, no supplier: standard price.
    await stockIn("NCR", P.std, 1, ist("2025-06-01", "10:00"));

    const bikeId = n(60);
    const cardId = n(61);
    await bike({ id: bikeId, ws: "NCR", reg: "DL1 DS 0001", purchasedAt: ist("2025-10-01", "10:00"), arrivedAt: ist("2025-10-02", "10:00") });
    await card({ id: cardId, ws: "NCR", bike: bikeId, confirmedAt: ist("2025-10-02", "10:00"), completeAt: ist("2025-10-10", "10:00") });
    await line({ id: n(62), ws: "NCR", card: cardId, part: P.reserved, required: 1, reserved: 1 });
    await line({ id: n(63), ws: "NCR", card: cardId, part: P.issued, required: 1, issued: 1 });
    await move({ ws: "NCR", part: P.issued, type: "issue", qty: 1, from: BINS.NCR.normal, at: ist("2025-10-10", "10:00"), line: n(63), user: STORE.NCR });
  });

  it("lists only stock with no issue, GRN or emergency buy in 90 days, net of reservations", async () => {
    const rows = await call(ncrManager, "dead_stock", { p_workshop_id: NCR, p_as_of: AS_OF });
    const bySku = Object.fromEntries(rows.map((r) => [r.sku, r]));
    expect(Object.keys(bySku).sort()).toEqual(["DS-AGED", "DS-OPEN", "DS-RES", "DS-STD"]);

    expect(bySku["DS-OPEN"]).toMatchObject({ dead_qty: 5, unit_price_paise: 7000, price_source: "supplier", value_paise: 35000 });
    expect(bySku["DS-RES"]).toMatchObject({ available: 2, dead_qty: 2, unit_price_paise: 12345, price_source: "last_grn", value_paise: 24690 });
    expect(bySku["DS-AGED"]).toMatchObject({ dead_qty: 4, unit_price_paise: 5000, value_paise: 20000 });
    expect(bySku["DS-STD"]).toMatchObject({ dead_qty: 1, unit_price_paise: 4321, price_source: "standard", value_paise: 4321 });

    const k = await kpis(ncrManager, NCR, AS_OF, AS_OF, AS_OF);
    expect(k.dead_stock_value_paise).toBe(35000 + 24690 + 20000 + 4321);
    expect(k.dead_stock_sku_n).toBe(4);
  });

  it("uses p_days for the window", async () => {
    // With a 10-day window neither the GRN 20 days ago nor the issue 10 days ago counts.
    const rows = await call(ncrManager, "dead_stock", { p_workshop_id: NCR, p_as_of: AS_OF, p_days: 10 });
    expect(rows.map((r) => r.sku).sort()).toEqual(["DS-AGED", "DS-GRN", "DS-ISS", "DS-OPEN", "DS-RES", "DS-STD"]);
  });
});

describe("emergency share and weighted premium (test 3)", () => {
  const P = { ncr: n(71), jpr: n(72) };
  const BUY = { two: n(73), one: n(74), noRef: n(75), jpr: n(76) };

  beforeAll(async () => {
    await fresh();
    await part(P.ncr, "EB-NCR");
    await part(P.jpr, "EB-JPR");
    for (const ws of ["NCR", "JPR"] as const) {
      const base = ws === "NCR" ? 80 : 90;
      await bike({ id: n(base), ws, reg: `${ws} EB 0001`, purchasedAt: ist("2025-10-01", "10:00"), arrivedAt: ist("2025-10-02", "10:00") });
      await card({ id: n(base + 1), ws, bike: n(base), confirmedAt: ist("2025-10-02", "10:00"), completeAt: ist("2025-10-10", "12:00") });
    }
    // Lines are inserted after the buys' stock arrives (a reservation needs stock).
    await db.query(
      `insert into public.job_card_lines (id, workshop_id, job_card_id, part_id, qty_required, source)
       values ($1, $2, $3, $4, 1, 'suggested'), ($5, $6, $7, $8, 1, 'suggested')`,
      [n(82), NCR, n(81), P.ncr, n(92), JPR, n(91), P.jpr],
    );
    await buy({ id: BUY.two, ws: "NCR", line: n(82), part: P.ncr, qty: 2, price: 30000, ref: 25000, at: ist("2025-10-10", "10:00") });
    await buy({ id: BUY.one, ws: "NCR", line: n(82), part: P.ncr, qty: 1, price: 18000, ref: 20000, at: ist("2025-10-10", "11:00") });
    await buy({ id: BUY.noRef, ws: "NCR", line: n(82), part: P.ncr, qty: 1, price: 10000, ref: null, at: ist("2025-10-10", "12:00") });
    await buy({ id: BUY.jpr, ws: "JPR", line: n(92), part: P.jpr, qty: 1, price: 22000, ref: 20000, at: ist("2025-10-10", "10:00") });
    await db.query(`update public.job_card_lines set qty_reserved = 1 where id in ($1, $2)`, [n(82), n(92)]);
    // GRN: 5 received, 1 damaged, 4 accepted at Rs 250 -> Rs 1,000 (damaged units excluded).
    await grn({ ws: "NCR", part: P.ncr, accepted: 4, damaged: 1, price: 25000, at: ist("2025-10-12", "10:00") });
  });

  it("weights the premium by quantity and counts buys without a reference separately", async () => {
    const k = await kpis(ncrManager, NCR, "2025-10-01", "2025-10-31", "2025-10-31");
    expect(k.emergency_spend_paise).toBe(60000 + 18000 + 10000);
    expect(k.grn_value_paise).toBe(100000);
    expect(num(k.emergency_share)).toBeCloseTo(88000 / 188000, 10);
    expect(num(k.emergency_premium)).toBeCloseTo(8000 / 70000, 10); // 11.4%
    expect(k.emergency_without_reference_n).toBe(1);
  });

  it("pools both workshops' rows for admin, not an average of the two figures", async () => {
    const k = await kpis(admin, null, "2025-10-01", "2025-10-31", "2025-10-31");
    expect(k.emergency_spend_paise).toBe(88000 + 22000);
    expect(num(k.emergency_premium)).toBeCloseTo(10000 / 90000, 10);
    expect(num(k.emergency_premium)).not.toBeCloseTo((8000 / 70000 + 0.1) / 2, 4);
    expect(num(k.emergency_share)).toBeCloseTo(110000 / 210000, 10);
  });

  it("lists buys with premium, totals and IST day", async () => {
    const rows = await view(ncrManager, "v_emergency_buys_list");
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual([BUY.two, BUY.one, BUY.noRef].sort());
    expect(byId[BUY.two]).toMatchObject({
      total_paise: 60000, premium_paise: 10000, bought_on: "2025-10-10", sku: "EB-NCR", reg_no: "NCR EB 0001",
      bought_by_name: "NCR Store Keeper",
    });
    expect(num(byId[BUY.two].premium)).toBeCloseTo(0.2, 10);
    expect(num(byId[BUY.one].premium)).toBeCloseTo(-0.1, 10);
    expect(byId[BUY.noRef].premium).toBeNull();
    expect(byId[BUY.noRef].premium_paise).toBeNull();
  });
});

describe("IST day boundary (test 4)", () => {
  const P = { b1: n(101), b2: n(102) };

  beforeAll(async () => {
    await fresh();
    await part(P.b1, "DB-1");
    await part(P.b2, "DB-2");
    await stockIn("NCR", P.b1, 3, ist("2025-06-01", "10:00"));
    await stockIn("NCR", P.b2, 5, ist("2025-06-01", "10:00"));
    await bike({ id: n(103), ws: "NCR", reg: "DL1 DB 0001", purchasedAt: ist("2025-10-01", "10:00"), arrivedAt: ist("2025-10-02", "10:00") });
    await card({ id: n(104), ws: "NCR", bike: n(103), confirmedAt: ist("2025-10-02", "10:00"), completeAt: ist("2025-10-02", "10:00") });
    await line({ id: n(105), ws: "NCR", card: n(104), part: P.b1, required: 1, issued: 1 });
    // After a wrong_fitment return, qty_required = net_issued (SPEC §8.2).
    await line({ id: n(106), ws: "NCR", card: n(104), part: P.b2, required: 1, issued: 2, returned: 1 });
    // 00:10 IST on 18 Oct = 18:40 UTC on 17 Oct.
    await move({ ws: "NCR", part: P.b1, type: "issue", qty: 1, from: BINS.NCR.normal, at: "2025-10-17T18:40:00Z", line: n(105) });
    await move({ ws: "NCR", part: P.b2, type: "issue", qty: 2, from: BINS.NCR.normal, at: ist("2025-10-19", "10:00"), line: n(106) });
    await move({
      ws: "NCR", part: P.b2, type: "return_to_stock", qty: 1, to: BINS.NCR.normal, at: ist("2025-10-19", "12:00"),
      line: n(106), reason: "wrong_fitment",
    });
  });

  it("buckets an issue at 00:10 IST on 18 Oct (18:40 UTC on 17 Oct) on 18 Oct", async () => {
    const d17 = await kpis(ncrManager, NCR, "2025-10-17", "2025-10-17", "2025-10-20");
    const d18 = await kpis(ncrManager, NCR, "2025-10-18", "2025-10-18", "2025-10-20");
    expect(d17.issued_qty).toBe(0);
    expect(d17.wrong_fit_rate).toBeNull();
    expect(d18.issued_qty).toBe(1);
    expect(num(d18.wrong_fit_rate)).toBe(0);
  });

  it("computes the wrong-fit rate from wrong_fitment returns over issues", async () => {
    const d19 = await kpis(ncrManager, NCR, "2025-10-19", "2025-10-19", "2025-10-20");
    expect(d19.issued_qty).toBe(2);
    expect(d19.wrong_fit_qty).toBe(1);
    expect(num(d19.wrong_fit_rate)).toBe(0.5);
  });

  it("ages dead stock by the IST day of the move", async () => {
    // as_of 15 Jan: the 90-day window starts 18 Oct, so the 00:10 IST issue keeps DB-1 alive.
    const jan15 = await call(ncrManager, "dead_stock", { p_workshop_id: NCR, p_as_of: "2026-01-15" });
    expect(jan15.map((r) => r.sku)).not.toContain("DB-1");
    // as_of 16 Jan: the window starts 19 Oct.
    const jan16 = await call(ncrManager, "dead_stock", { p_workshop_id: NCR, p_as_of: "2026-01-16" });
    expect(jan16.map((r) => r.sku)).toContain("DB-1");
    expect(jan16.map((r) => r.sku)).not.toContain("DB-2");
  });
});

describe("blocked bikes board and inbound shortfalls", () => {
  const P = { p1: n(111), p2: n(112), p3: n(113), p4: n(114) };
  const K = {
    k1: { bike: n(121), card: n(122) },
    k2: { bike: n(123), card: n(124) },
    k3: { bike: n(125), card: n(126) },
    k4: { bike: n(127), card: n(128) },
    k5: { bike: n(129), card: n(130) },
  };
  const LINE = { k1p1: n(131), k1p2: n(132), k1p3: n(133), k1p4: n(134), k3p4: n(135), k3p3: n(136), k4p4: n(137), k5p3: n(138) };
  const codes: Record<string, string> = {};
  let po1 = "";

  beforeAll(async () => {
    await fresh();
    await part(P.p1, "BB-P1");
    await part(P.p2, "BB-P2");
    await part(P.p3, "BB-P3");
    await part(P.p4, "BB-P4");
    await stockIn("NCR", P.p4, 2, ist("2025-10-01", "10:00"));
    po1 = await sentPo("NCR", P.p1, 2, 30);
    await sentPo("NCR", P.p2, 1, -2);

    const arrivedBike = (id: string, reg: string, day: string, status: "at_workshop" | "in_repair" = "at_workshop") =>
      bike({
        id, ws: "NCR", reg, status, purchasedAt: ist(day, "08:00"), arrivedAt: ist(day, "09:00"),
        bayInAt: status === "in_repair" ? ist(day, "09:30") : null,
      });

    // K1: four missing parts (on PO, overdue PO, not ordered, held by blocked K3).
    await arrivedBike(K.k1.bike, "DL1 BB 0001", "2025-10-15");
    codes.k1 = await card({ id: K.k1.card, ws: "NCR", bike: K.k1.bike, confirmedAt: ist("2025-10-15", "12:00") });
    // K2: no missing part, but needs review.
    await arrivedBike(K.k2.bike, "DL1 BB 0002", "2025-10-14");
    codes.k2 = await card({
      id: K.k2.card, ws: "NCR", bike: K.k2.bike, confirmedAt: ist("2025-10-14", "10:00"), needsReview: "wrong_fitment: BB-P1",
    });
    // K3 (in repair): holds P4, blocked on P3.
    await arrivedBike(K.k3.bike, "DL1 BB 0003", "2025-10-16", "in_repair");
    codes.k3 = await card({ id: K.k3.card, ws: "NCR", bike: K.k3.bike, confirmedAt: ist("2025-10-16", "10:00") });
    // K4: complete, holds P4 (not blocked, so not a candidate).
    await arrivedBike(K.k4.bike, "DL1 BB 0004", "2025-10-13");
    codes.k4 = await card({
      id: K.k4.card, ws: "NCR", bike: K.k4.bike, confirmedAt: ist("2025-10-13", "10:00"), completeAt: ist("2025-10-13", "10:00"),
    });
    // K5: purchased (in transit), short of P3.
    await bike({ id: K.k5.bike, ws: "NCR", reg: "DL1 BB 0005", status: "purchased", purchasedAt: ist("2025-10-17", "10:00") });
    codes.k5 = await card({ id: K.k5.card, ws: "NCR", bike: K.k5.bike, confirmedAt: ist("2025-10-17", "11:00") });

    await line({ id: LINE.k1p1, ws: "NCR", card: K.k1.card, part: P.p1, required: 2 });
    await line({ id: LINE.k1p2, ws: "NCR", card: K.k1.card, part: P.p2, required: 1 });
    await line({ id: LINE.k1p3, ws: "NCR", card: K.k1.card, part: P.p3, required: 1 });
    await line({ id: LINE.k1p4, ws: "NCR", card: K.k1.card, part: P.p4, required: 1 });
    await line({ id: LINE.k3p4, ws: "NCR", card: K.k3.card, part: P.p4, required: 1, reserved: 1 });
    await line({ id: LINE.k3p3, ws: "NCR", card: K.k3.card, part: P.p3, required: 1 });
    await line({ id: LINE.k4p4, ws: "NCR", card: K.k4.card, part: P.p4, required: 1, reserved: 1 });
    await line({ id: LINE.k5p3, ws: "NCR", card: K.k5.card, part: P.p3, required: 1 });
  });

  type Missing = {
    line_id: string; sku: string; uncovered: number; eta_status: string; po_code: string | null;
    expected_on: string | null; is_overdue: boolean;
    reallocation_candidates: { line_id: string; card_code: string; reg_no: string; qty_reserved: number }[];
  };
  type Blocked = Row & { missing_parts: Missing[] };

  it("lists blocked bikes with missing parts, ETA, review reason and reallocation candidates", async () => {
    const rows = await view<Blocked>(ncrManager, "v_blocked_bikes");
    const sorted = [...rows].sort((a, b) => Date.parse(String(a.waiting_since)) - Date.parse(String(b.waiting_since)));
    expect(sorted.map((r) => r.card_code)).toEqual([codes.k2, codes.k1, codes.k3]);

    const k1 = rows.find((r) => r.job_card_id === K.k1.card)!;
    expect(Date.parse(String(k1.waiting_since))).toBe(Date.parse(ist("2025-10-15", "12:00")));
    expect(k1).toMatchObject({ reg_no: "DL1 BB 0001", make: "Hero", model: "Splendor Plus", mfg_year: 2021, missing_count: 4 });
    const m = Object.fromEntries(k1.missing_parts.map((x) => [x.sku, x]));
    expect(k1.missing_parts.map((x) => x.sku)).toEqual(["BB-P1", "BB-P2", "BB-P3", "BB-P4"]);
    expect(m["BB-P1"]).toMatchObject({ uncovered: 2, eta_status: "on_po", po_code: po1, is_overdue: false, reallocation_candidates: [] });
    expect(m["BB-P1"].expected_on).not.toBeNull();
    expect(m["BB-P2"]).toMatchObject({ eta_status: "on_po", is_overdue: true });
    expect(m["BB-P3"]).toMatchObject({ eta_status: "not_ordered", po_code: null, reallocation_candidates: [] });
    expect(m["BB-P4"].reallocation_candidates).toEqual([
      { line_id: LINE.k3p4, job_card_id: K.k3.card, card_code: codes.k3, reg_no: "DL1 BB 0003", qty_reserved: 1 },
    ]);

    const k2 = rows.find((r) => r.job_card_id === K.k2.card)!;
    expect(k2).toMatchObject({ needs_review_reason: "wrong_fitment: BB-P1", missing_parts: [], missing_count: 0 });

    const k3 = rows.find((r) => r.job_card_id === K.k3.card)!;
    expect(k3.bike_status).toBe("in_repair");
    expect(k3.missing_parts.map((x) => x.sku)).toEqual(["BB-P3"]);
  });

  it("lists in-transit bikes only under inbound shortfalls", async () => {
    const rows = await view<Blocked>(ncrManager, "v_inbound_shortfalls");
    expect(rows.map((r) => r.card_code)).toEqual([codes.k5]);
    expect(rows[0]).toMatchObject({ bike_status: "purchased", missing_count: 1 });
    expect(rows[0].missing_parts[0]).toMatchObject({ line_id: LINE.k5p3, sku: "BB-P3", eta_status: "not_ordered" });
  });

  it("counts overdue POs as of p_as_of", async () => {
    const k = await kpis(ncrManager, NCR, "2025-10-01", "2025-10-31");
    expect(k.po_overdue_n).toBe(1);
  });

  it("exposes the missing lines with the same candidates", async () => {
    const rows = await view(ncrManager, "v_missing_parts");
    expect(rows).toHaveLength(6); // K1 x4, K3 P3, K5 P3
    const k1p4 = rows.find((r) => r.line_id === LINE.k1p4)!;
    expect(k1p4.reallocation_candidates).toHaveLength(1);
  });
});

describe("stock ledger", () => {
  const PART_L = n(141);
  const BIN2 = n(142);
  let grnCode = "";
  let poCode = "";
  let cardCode = "";

  beforeAll(async () => {
    await fresh();
    await part(PART_L, "LG-1");
    await db.query(`insert into public.bins (id, workshop_id, code, kind) values ($1, $2, 'NCR-A01-02', 'normal')`, [BIN2, NCR]);
    await bike({ id: n(143), ws: "NCR", reg: "DL1 LG 0001", purchasedAt: ist("2025-10-01", "10:00"), arrivedAt: ist("2025-10-02", "10:00") });
    cardCode = await card({ id: n(144), ws: "NCR", bike: n(143), confirmedAt: ist("2025-10-02", "10:00"), completeAt: ist("2025-10-04", "10:00") });
    await line({ id: n(145), ws: "NCR", card: n(144), part: PART_L, required: 1, issued: 1 });

    ({ grnCode, poCode } = await grn({ ws: "NCR", part: PART_L, accepted: 3, price: 5000, at: ist("2025-10-03", "10:00") }));
    await move({ ws: "NCR", part: PART_L, type: "putaway", qty: 2, from: BINS.NCR.rcv, to: BINS.NCR.normal, at: ist("2025-10-03", "11:00"), user: STORE.NCR });
    await move({ ws: "NCR", part: PART_L, type: "adjust_in", qty: 1, to: BINS.NCR.normal, at: ist("2025-10-03", "12:00"), reason: "found" });
    await move({ ws: "NCR", part: PART_L, type: "issue", qty: 1, from: BINS.NCR.normal, at: ist("2025-10-04", "10:00"), line: n(145), user: STORE.NCR });
    await move({ ws: "NCR", part: PART_L, type: "move", qty: 1, from: BINS.NCR.normal, to: BIN2, at: ist("2025-10-04", "11:00"), user: STORE.NCR });
  });

  it("pages newest first with p_before_id", async () => {
    const ledger = (before?: number) =>
      call(ncrManager, "stock_ledger", {
        p_workshop_id: NCR, p_part_id: PART_L, p_limit: 2, ...(before ? { p_before_id: before } : {}),
      });
    const p1 = await ledger();
    expect(p1.map((r) => r.move_type)).toEqual(["move", "issue"]);
    const p2 = await ledger(Number(p1[1].id));
    expect(p2.map((r) => r.move_type)).toEqual(["adjust_in", "putaway"]);
    const p3 = await ledger(Number(p2[1].id));
    expect(p3.map((r) => r.move_type)).toEqual(["grn"]);
    expect(await ledger(Number(p3[0].id))).toEqual([]);

    expect(p3[0]).toMatchObject({ grn_code: grnCode, po_code: poCode, to_bin_code: "NCR-RCV", user_full_name: "NCR Store Keeper" });
    expect(p1[1]).toMatchObject({ job_card_code: cardCode, reg_no: "DL1 LG 0001", from_bin_code: "NCR-A01-01", bin_delta: null });
    expect(p2[0]).toMatchObject({ reason: "found", user_full_name: "NCR Manager" });
  });

  it("filters by bin with the signed change to that bin", async () => {
    const rows = await call(ncrManager, "stock_ledger", { p_workshop_id: NCR, p_part_id: PART_L, p_bin_id: BINS.NCR.normal });
    expect(rows.map((r) => [r.move_type, r.bin_delta])).toEqual([
      ["move", -1],
      ["issue", -1],
      ["adjust_in", 1],
      ["putaway", 2],
    ]);
  });
});

describe("workshop scoping (test 5)", () => {
  const P = { short: n(151), buy: n(152), dead: n(153) };

  beforeAll(async () => {
    await fresh();
    await part(P.short, "SC-SHORT");
    await part(P.buy, "SC-BUY");
    await part(P.dead, "SC-DEAD");
    await db.query(
      `insert into public.reorder_settings (workshop_id, part_id, auto, safety_stock, max_qty) values ($1, $2, true, 2, 10)`,
      [JPR, CAT.part],
    );
    for (const ws of ["NCR", "JPR"] as const) {
      const base = ws === "NCR" ? 160 : 170;
      await stockIn(ws, P.dead, 3, daysAgo(120));
      // Blocked bike (also holds an emergency-bought part) and an in-transit bike, both short.
      await bike({ id: n(base), ws, reg: `${ws} SC 0001`, purchasedAt: ist("2025-10-14", "10:00"), arrivedAt: ist("2025-10-15", "10:00") });
      await card({ id: n(base + 1), ws, bike: n(base), confirmedAt: ist("2025-10-14", "12:00") });
      await line({ id: n(base + 2), ws, card: n(base + 1), part: P.short, required: 1 });
      await line({ id: n(base + 3), ws, card: n(base + 1), part: P.buy, required: 1 });
      await buy({ id: n(base + 4), ws, line: n(base + 3), part: P.buy, qty: 1, price: 15000, ref: 12000, at: ist("2025-10-15", "11:00") });
      await db.query(`update public.job_card_lines set qty_reserved = 1 where id = $1`, [n(base + 3)]);
      await bike({ id: n(base + 5), ws, reg: `${ws} SC 0002`, status: "purchased", purchasedAt: ist("2025-10-16", "10:00") });
      await card({ id: n(base + 6), ws, bike: n(base + 5), confirmedAt: ist("2025-10-16", "11:00") });
      await line({ id: n(base + 7), ws, card: n(base + 6), part: P.short, required: 1 });
    }
  });

  const range = { p_from: "2025-10-01", p_to: "2025-10-31", p_as_of: "2025-10-31" };

  it("shows a Jaipur manager only Jaipur rows from every view and function; admin sees both", async () => {
    for (const name of ["v_blocked_bikes", "v_inbound_shortfalls", "v_missing_parts", "v_emergency_buys_list"]) {
      expect(workshopsOf(await view(jprManager, name)), name).toEqual([JPR]);
      expect(workshopsOf(await view(admin, name)), name).toEqual([NCR, JPR].sort());
    }

    const fns: [string, Row][] = [
      ["part_waits", { p_workshop_id: null, ...range }],
      ["dead_stock", { p_workshop_id: null }],
      ["stock_ledger", { p_workshop_id: null, p_part_id: null }],
    ];
    for (const [fn, args] of fns) {
      expect(workshopsOf(await call(jprManager, fn, args)), fn).toEqual([JPR]);
      expect(workshopsOf(await call(admin, fn, args)), fn).toEqual([NCR, JPR].sort());
    }
    // Asking for the other workshop by id returns nothing.
    expect(await call(jprManager, "part_waits", { p_workshop_id: NCR, ...range })).toEqual([]);
    expect(await call(jprManager, "dead_stock", { p_workshop_id: NCR })).toEqual([]);
    expect(await call(jprManager, "stock_ledger", { p_workshop_id: NCR, p_part_id: null })).toEqual([]);

    const jprAll = await kpis(jprManager, null, range.p_from, range.p_to, range.p_as_of);
    const jprNcr = await kpis(jprManager, NCR, range.p_from, range.p_to, range.p_as_of);
    const adminAll = await kpis(admin, null, range.p_from, range.p_to, range.p_as_of);
    expect(jprAll).toMatchObject({ wait_n: 1, emergency_spend_paise: 15000 });
    expect(jprNcr).toMatchObject({ wait_n: 0, emergency_spend_paise: 0, dead_stock_value_paise: 0 });
    expect(adminAll).toMatchObject({ wait_n: 2, emergency_spend_paise: 30000 });
  });

  it("lets a Jaipur manager call reorder_suggestions, kpis, dead_stock and search_parts without p_as_of", async () => {
    const reorder = await jprManager.rpc("reorder_suggestions", { p_workshop_id: JPR });
    expect(reorder.error, JSON.stringify(reorder.error)).toBeNull();
    expect(reorder.data!.length).toBeGreaterThan(0);

    const k = await jprManager.rpc("kpis", { p_workshop_id: JPR, p_from: "2025-10-01", p_to: "2025-10-31" });
    expect(k.error, JSON.stringify(k.error)).toBeNull();
    expect(k.data).toHaveLength(1);
    expect(k.data![0].dead_stock_sku_n).toBe(1);

    const dead = await jprManager.rpc("dead_stock", { p_workshop_id: JPR });
    expect(dead.error, JSON.stringify(dead.error)).toBeNull();
    expect(dead.data!.map((r) => r.sku)).toEqual(["SC-DEAD"]);

    const search = await jprManager.rpc("search_parts", { p_q: "oil", p_workshop_id: JPR });
    expect(search.error, JSON.stringify(search.error)).toBeNull();
    expect(search.data!.length).toBeGreaterThan(0);
  });
});

describe("no activity (test 6)", () => {
  beforeAll(fresh);

  it("returns zeros and nulls for a workshop with nothing in the range", async () => {
    const k = await kpis(admin, JPR, "2025-10-01", "2025-10-31", "2025-10-31");
    expect(k).toEqual({
      wait_n: 0,
      wait_completed_n: 0,
      wait_still_waiting_n: 0,
      wait_still_waiting_avg_hours: null,
      wait_zero_pct: null,
      wait_median_hours: null,
      wait_p90_hours: null,
      emergency_spend_paise: 0,
      grn_value_paise: 0,
      emergency_share: null,
      emergency_premium: null,
      emergency_without_reference_n: 0,
      dead_stock_value_paise: 0,
      dead_stock_sku_n: 0,
      wrong_fit_qty: 0,
      issued_qty: 0,
      wrong_fit_rate: null,
      po_overdue_n: 0,
    });
    expect(await call(jprManager, "part_waits", { p_workshop_id: JPR, p_from: "2025-10-01", p_to: "2025-10-31" })).toEqual([]);
    expect(await call(jprManager, "dead_stock", { p_workshop_id: JPR })).toEqual([]);
    expect(await call(jprManager, "stock_ledger", { p_workshop_id: JPR, p_part_id: null })).toEqual([]);
    expect(await view(jprManager, "v_blocked_bikes")).toEqual([]);
  });
});
