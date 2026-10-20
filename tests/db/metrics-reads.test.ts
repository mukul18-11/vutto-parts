// Read SQL for the metrics, dead stock and admin screens (Prompt 13, migration metrics_admin_reads):
// wrong_fit_returns (the list behind the wrong-fit rate), dead_stock_list (dead_stock plus age and
// last movement), and the reads the admin page and the reset banner make, all under RLS. History
// is inserted as postgres with explicit timestamps and p_as_of is explicit (SPEC §17).
import type pg from "pg";
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
const ADMIN = userId("admin");
const n = (i: number) => `e2000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
const ist = (day: string, time: string) => `${day}T${time}:00+05:30`;

let db: pg.Client;
let admin: Client;
let ncrManager: Client;
let jprManager: Client;
let ncrStore: Client;
let seq = 0;
const code = (prefix: string, ws: WorkshopCode) => `${prefix}-${ws}-${String(++seq).padStart(6, "0")}`;

beforeAll(async () => {
  db = await pgClient();
  admin = await clientAs("admin");
  ncrManager = await clientAs("ncr_manager");
  jprManager = await clientAs("jpr_manager");
  ncrStore = await clientAs("ncr_store");
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

// ---------------------------------------------------------------------------------------------
// Fixture helpers (as postgres).

async function fresh() {
  await testClear(db);
  await insertCatalog(db);
  await insertBins(db, "NCR");
  await insertBins(db, "JPR");
}

async function part(id: string, sku: string) {
  await db.query(
    `insert into public.parts (id, sku, name, category, part_type, uom, standard_price_paise)
     values ($1, $2, 'Part ' || $2::text, 'wear', 'test_part', 'pcs', 10000)`,
    [id, sku],
  );
}

/** An arrived bike with a closed card (parts complete) and one line. */
async function closedCardLine(o: { ws: WorkshopCode; bike: string; card: string; line: string; reg: string; part: string; required: number; issued: number; returned: number }) {
  await db.query(
    `insert into public.bikes (id, workshop_id, reg_no, model_id, variant_id, mfg_year, status, purchased_at, arrived_at)
     values ($1, $2, $3, $4, $5, 2021, 'at_workshop', $6, $6)`,
    [o.bike, WORKSHOP_IDS[o.ws], o.reg, CAT.model, CAT.variant, ist("2025-08-01", "10:00")],
  );
  await db.query(
    `insert into public.job_cards
       (id, workshop_id, code, bike_id, status, confirmed_at, confirmed_by, parts_complete_at, closed_at)
     values ($1, $2, $3, $4, 'closed', $5, $6, $5, $5)`,
    [o.card, WORKSHOP_IDS[o.ws], code("JC", o.ws), o.bike, ist("2025-08-01", "11:00"), MANAGER[o.ws]],
  );
  await db.query(
    `insert into public.job_card_lines
       (id, workshop_id, job_card_id, part_id, qty_required, qty_issued, qty_returned, source)
     values ($1, $2, $3, $4, $5, $6, $7, 'suggested')`,
    [o.line, WORKSHOP_IDS[o.ws], o.card, o.part, o.required, o.issued, o.returned],
  );
}

type MoveOpts = {
  ws: WorkshopCode;
  part: string;
  type: string;
  qty: number;
  from?: string | null;
  to?: string | null;
  at: string;
  line?: string;
  grnLine?: string;
  reason?: string;
  note?: string;
  user?: string;
};

async function move(o: MoveOpts) {
  await db.query(
    `insert into public.stock_moves
       (workshop_id, part_id, move_type, qty, from_bin_id, to_bin_id, job_card_line_id, grn_line_id, reason, note,
        user_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      WORKSHOP_IDS[o.ws], o.part, o.type, o.qty, o.from ?? null, o.to ?? null, o.line ?? null, o.grnLine ?? null,
      o.reason ?? null, o.note ?? null, o.user ?? STORE[o.ws], o.at,
    ],
  );
}

const stockIn = (ws: WorkshopCode, part: string, qty: number, at: string, bin?: string) =>
  move({ ws, part, type: "adjust_in", qty, to: bin ?? BINS[ws].normal, at, reason: "opening_balance", user: MANAGER[ws] });

/** A closed PO with one GRN line received at `at` into receiving. */
async function grn(o: { ws: WorkshopCode; part: string; accepted: number; price: number; at: string }) {
  const w = WORKSHOP_IDS[o.ws];
  const ids = await db.query<{ po: string; pol: string; grn: string; grnl: string }>(
    `select gen_random_uuid() as po, gen_random_uuid() as pol, gen_random_uuid() as grn, gen_random_uuid() as grnl`,
  );
  const { po, pol, grn: grnId, grnl } = ids.rows[0];
  const poCode = code("PO", o.ws);
  const grnCode = code("GRN", o.ws);
  await db.query(
    `insert into public.purchase_orders (id, workshop_id, code, supplier_id, status, sent_at, expected_on)
     values ($1, $2, $3, $4, 'closed', $5, private.ist_date($5))`,
    [po, w, poCode, CAT.supplier, o.at],
  );
  await db.query(
    `insert into public.po_lines (id, workshop_id, po_id, part_id, qty_ordered, qty_accepted, unit_price_paise, source)
     values ($1, $2, $3, $4, $5, $5, $6, 'suggested')`,
    [pol, w, po, o.part, o.accepted, o.price],
  );
  await db.query(
    `insert into public.grns (id, workshop_id, code, po_id, supplier_id, supplier_invoice_no, invoice_date, received_by, received_at)
     values ($1, $2, $3, $4, $5, $3, private.ist_date($6), $7, $6)`,
    [grnId, w, grnCode, po, CAT.supplier, o.at, STORE[o.ws]],
  );
  await db.query(
    `insert into public.grn_lines (id, workshop_id, grn_id, po_line_id, part_id, qty_received, qty_accepted, unit_price_paise)
     values ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [grnl, w, grnId, pol, o.part, o.accepted, o.price],
  );
  await move({ ws: o.ws, part: o.part, type: "grn", qty: o.accepted, to: BINS[o.ws].rcv, at: o.at, grnLine: grnl });
}

type Row = Record<string, unknown>;

async function call<T = Row>(c: Client, fn: string, args: Row): Promise<T[]> {
  const { data, error } = await c.rpc(fn as never, args as never);
  expect(error, JSON.stringify(error)).toBeNull();
  return data as unknown as T[];
}

const workshopsOf = (rows: Row[]) => [...new Set(rows.map((r) => r.workshop_id))].sort();

// ---------------------------------------------------------------------------------------------

describe("wrong_fit_returns", () => {
  const P = { ncr: n(1), jpr: n(2) };
  const L = { ncr: n(3), jpr: n(4) };
  const OCT = { p_from: "2025-10-01", p_to: "2025-10-31" };

  beforeAll(async () => {
    await fresh();
    await part(P.ncr, "WF-NCR");
    await part(P.jpr, "WF-JPR");
    await stockIn("NCR", P.ncr, 10, ist("2025-08-01", "09:00"));
    await stockIn("JPR", P.jpr, 5, ist("2025-08-01", "09:00"));
    // NCR: 4 issued, 3 returned (one wrong fit in September, one in October, one not needed).
    await closedCardLine({ ws: "NCR", bike: n(10), card: n(11), line: L.ncr, reg: "DL1 WF 0001", part: P.ncr, required: 1, issued: 4, returned: 3 });
    const ncr = { ws: "NCR" as const, part: P.ncr, line: L.ncr };
    await move({ ...ncr, type: "issue", qty: 1, from: BINS.NCR.normal, at: ist("2025-09-10", "10:00") });
    await move({ ...ncr, type: "return_to_stock", qty: 1, to: BINS.NCR.normal, at: ist("2025-09-12", "10:00"), reason: "wrong_fitment", note: "September mismatch" });
    await move({ ...ncr, type: "issue", qty: 3, from: BINS.NCR.normal, at: ist("2025-10-05", "10:00") });
    await move({ ...ncr, type: "return_to_stock", qty: 1, to: BINS.NCR.normal, at: ist("2025-10-10", "10:00"), reason: "wrong_fitment", note: "Wrong thread size" });
    await move({ ...ncr, type: "return_to_stock", qty: 1, to: BINS.NCR.normal, at: ist("2025-10-11", "10:00"), reason: "not_needed" });
    // JPR: one wrong fit in October.
    await closedCardLine({ ws: "JPR", bike: n(20), card: n(21), line: L.jpr, reg: "RJ14 WF 0001", part: P.jpr, required: 1, issued: 2, returned: 1 });
    const jpr = { ws: "JPR" as const, part: P.jpr, line: L.jpr };
    await move({ ...jpr, type: "issue", qty: 2, from: BINS.JPR.normal, at: ist("2025-10-06", "10:00") });
    await move({ ...jpr, type: "return_to_stock", qty: 1, to: BINS.JPR.normal, at: ist("2025-10-08", "10:00"), reason: "wrong_fitment", note: "Wrong model" });
  });

  it("lists only wrong_fitment return_to_stock moves in the IST range, with card, bike, part and user", async () => {
    const rows = await call(ncrManager, "wrong_fit_returns", { p_workshop_id: NCR, ...OCT });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workshop_id: NCR, job_card_id: n(11), reg_no: "DL1 WF 0001", part_id: P.ncr, sku: "WF-NCR", uom: "pcs",
      qty: 1, note: "Wrong thread size", user_name: "NCR Store Keeper",
    });
    expect(rows[0].card_code).toMatch(/^JC-NCR-/);
  });

  it("sums to kpis().wrong_fit_qty for the same range, newest first over a wider range", async () => {
    const [k] = await call(ncrManager, "kpis", { p_workshop_id: NCR, ...OCT, p_as_of: "2025-10-31" });
    expect(k).toMatchObject({ wrong_fit_qty: 1, issued_qty: 3 });

    const wide = await call(ncrManager, "wrong_fit_returns", { p_workshop_id: NCR, p_from: "2025-09-01", p_to: "2025-10-31" });
    expect(wide.map((r) => r.note)).toEqual(["Wrong thread size", "September mismatch"]);
    const [kWide] = await call(ncrManager, "kpis", { p_workshop_id: NCR, p_from: "2025-09-01", p_to: "2025-10-31", p_as_of: "2025-10-31" });
    expect(kWide.wrong_fit_qty).toBe(wide.reduce((s, r) => s + Number(r.qty), 0));
  });

  it("is scoped by RLS: a Jaipur manager sees only Jaipur, admin with null sees both", async () => {
    expect(await call(jprManager, "wrong_fit_returns", { p_workshop_id: NCR, ...OCT })).toEqual([]);
    expect(workshopsOf(await call(jprManager, "wrong_fit_returns", { p_workshop_id: null, ...OCT }))).toEqual([JPR]);
    expect(workshopsOf(await call(admin, "wrong_fit_returns", { p_workshop_id: null, ...OCT }))).toEqual([NCR, JPR].sort());
  });
});

describe("dead_stock_list", () => {
  const AS_OF = "2025-10-20";
  const P = { aged: n(31), opening: n(32), recent: n(33), jpr: n(34) };

  beforeAll(async () => {
    await fresh();
    await part(P.aged, "DL-AGED");
    await part(P.opening, "DL-OPEN");
    await part(P.recent, "DL-RECENT");
    await part(P.jpr, "DL-JPR");
    // Old GRN; a putaway and an adjust_in inside the window are the last moves but do not reset
    // the age; a move after as_of is not the last move as of then.
    await grn({ ws: "NCR", part: P.aged, accepted: 3, price: 5000, at: ist("2025-06-01", "11:00") });
    await move({ ws: "NCR", part: P.aged, type: "putaway", qty: 2, from: BINS.NCR.rcv, to: BINS.NCR.normal, at: ist("2025-10-15", "10:00") });
    await move({ ws: "NCR", part: P.aged, type: "adjust_in", qty: 1, to: BINS.NCR.normal, at: ist("2025-10-18", "10:00"), reason: "found", user: MANAGER.NCR });
    await move({ ws: "NCR", part: P.aged, type: "adjust_in", qty: 1, to: BINS.NCR.normal, at: ist("2025-10-25", "10:00"), reason: "found", user: MANAGER.NCR });
    // Opening balance only: never issued or received.
    await stockIn("NCR", P.opening, 2, ist("2025-06-22", "10:00"));
    // Received 20 days before as_of: not dead.
    await grn({ ws: "NCR", part: P.recent, accepted: 2, price: 9000, at: ist("2025-09-30", "11:00") });
    await stockIn("JPR", P.jpr, 1, ist("2025-06-22", "10:00"));
  });

  it("has exactly dead_stock's rows and values", async () => {
    const list = await call(ncrManager, "dead_stock_list", { p_workshop_id: NCR, p_as_of: AS_OF });
    const base = await call(ncrManager, "dead_stock", { p_workshop_id: NCR, p_as_of: AS_OF });
    const pick = (r: Row) => ({ part_id: r.part_id, dead_qty: r.dead_qty, unit_price_paise: r.unit_price_paise, value_paise: r.value_paise, last_activity_at: r.last_activity_at });
    expect(list.map(pick)).toEqual(base.map(pick));
    expect(list.map((r) => r.sku).sort()).toEqual(["DL-AGED", "DL-OPEN"]);
  });

  it("ages from the last issue or receipt and shows the latest move of any type up to as_of", async () => {
    const list = await call(ncrManager, "dead_stock_list", { p_workshop_id: NCR, p_as_of: AS_OF });
    const bySku = Object.fromEntries(list.map((r) => [r.sku, r]));
    expect(bySku["DL-AGED"]).toMatchObject({ age_days: 141, last_move_type: "adjust_in" });
    expect(new Date(bySku["DL-AGED"].last_move_at as string).toISOString()).toBe(new Date(ist("2025-10-18", "10:00")).toISOString());
    expect(bySku["DL-OPEN"]).toMatchObject({ age_days: null, last_activity_at: null, last_move_type: "adjust_in" });
  });

  it("is scoped by RLS", async () => {
    expect(await call(jprManager, "dead_stock_list", { p_workshop_id: NCR, p_as_of: AS_OF })).toEqual([]);
    expect(workshopsOf(await call(admin, "dead_stock_list", { p_workshop_id: null, p_as_of: AS_OF }))).toEqual([NCR, JPR].sort());
  });
});

describe("admin page and reset banner reads", () => {
  beforeAll(async () => {
    await fresh();
    await db.query(
      `insert into public.app_errors (user_id, route, code, message) values ($1, '/stock', 'XX000', 'boom')`,
      [STORE.NCR],
    );
    await db.query(
      `insert into public.activity_log (workshop_id, entity_type, entity_id, action, user_id, is_simulated, created_at)
       values ($1, 'bike', $2, 'create', $3, true, now() - interval '1 hour'),
              ($1, 'bike', $2, 'arrive', $4, false, now() - interval '2 hours'),
              ($1, 'bike', $2, 'seeded', $3, true, now())`,
      [NCR, n(40), MANAGER.NCR, STORE.NCR],
    );
  });

  it("app_errors are admin only", async () => {
    const asAdmin = await admin.from("app_errors").select("code");
    expect(asAdmin.error).toBeNull();
    expect(asAdmin.data!.map((r) => r.code)).toContain("XX000");
    const asManager = await ncrManager.from("app_errors").select("code");
    expect(asManager.error).toBeNull();
    expect(asManager.data).toEqual([]);
  });

  it("last user activity is the newest activity_log row that is not simulated", async () => {
    const { data, error } = await admin
      .from("activity_log")
      .select("action, user_id")
      .eq("is_simulated", false)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({ action: "arrive", user_id: STORE.NCR });
  });

  it("every role can read the last reset and the admin's name for the banner", async () => {
    const meta = await ncrStore.from("demo_meta").select("last_reset_at, last_reset_by").maybeSingle();
    expect(meta.error).toBeNull();
    expect(meta.data).not.toBeNull();
    const name = await ncrStore.from("profiles").select("full_name").eq("user_id", ADMIN).maybeSingle();
    expect(name.error).toBeNull();
    expect(name.data?.full_name).toBeTruthy();
  });
});
