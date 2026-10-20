// Purchasing part B (SPEC §7.4-7.7): receive_grn, short_close_po, cancel_po, PO status
// derivation, v_line_eta and v_excess_on_order, acting as the demo users.
// No concurrency tests: the user dropped them (prompt tests 8 and 14, and SPEC §17's
// "GRN and confirm on the same parts", are not covered here).
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { istToday } from "../../src/lib/time";
import { clientAs, pgClient, type Client } from "./clients";
import { insertBins, testClear } from "./fixtures";
import { expectInvariantsHold } from "./invariants";
import {
  confirmAs,
  createBikeAs,
  detail,
  expectCode,
  expectOk,
  FT,
  insertJobCardCatalog,
  M,
  ncr,
  NCR,
  P,
  queryOne,
  rpc,
  V,
  type Card,
  type RpcResult,
} from "./job-card-fixtures";
import { insertPurchasingCatalog, poLines as poLinesOf, sendPo as sendPoAs, SUP, type Po } from "./purchasing-fixtures";

let db: pg.Client;
let ncrManager: Client;
let ncrStore: Client;
let jprManager: Client;
let jprStore: Client;

type GrnLineIn = {
  po_line_id: string;
  qty_received: number;
  qty_damaged?: number;
  qty_wrong_part?: number;
  unit_price_paise?: number;
};
type GrnLine = {
  sku: string;
  qty_received: number;
  qty_accepted: number;
  qty_damaged: number;
  qty_wrong_part: number;
  unit_price_paise: number;
  po_unit_price_paise: number;
  price_variance: boolean;
  open_qty: number;
};
type Allocation = { reg_no: string; card_code: string; part: string; qty: number; waiting_since: string | null };
type GrnResult = { grn: { code: string; po_status: string; lines: GrnLine[] }; allocations: Allocation[] };

const one = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => queryOne<T>(db, sql, params);
const sendPo = (lines: { part: string; qty: number; price?: number }[], supplier: string = SUP.ncr) =>
  sendPoAs(ncrManager, lines, supplier);
const poLines = () => poLinesOf(db, NCR);

/** short_close_po's p_line_ids = null means every line; generated types cannot express a nullable array. */
const ALL_LINES = null as unknown as string[];

let invoiceNo = 0;
function receive(
  po: Po,
  lines: GrnLineIn[],
  opts: { invoice?: string; date?: string; allowDup?: boolean; as?: Client } = {},
): Promise<RpcResult> {
  return rpc(opts.as ?? ncrStore, "receive_grn", {
    p_po_id: po.po_id,
    p_supplier_invoice_no: opts.invoice ?? `INV-${++invoiceNo}`,
    p_invoice_date: opts.date ?? istToday(),
    p_allow_duplicate_invoice: opts.allowDup ?? false,
    p_lines: lines,
  });
}

/** One input line for the PO's line of the given part. */
const lineIn = (po: Po, sku: string, qty: number, extra: Partial<GrnLineIn> = {}): GrnLineIn => ({
  po_line_id: po.lines.find((l) => l.sku === sku)!.line_id,
  qty_received: qty,
  ...extra,
});

async function poLine(po: Po, sku: string) {
  return one<{ qty_accepted: number; qty_rejected: number; qty_cancelled: number; open_qty: number }>(
    `select pl.qty_accepted, pl.qty_rejected, pl.qty_cancelled, pl.open_qty
     from public.po_lines pl join public.parts p on p.id = pl.part_id
     where pl.po_id = $1 and p.sku = $2`,
    [po.po_id, sku],
  );
}

const poStatus = async (po: Po) =>
  (await one<{ status: string }>(`select status::text from public.purchase_orders where id = $1`, [po.po_id]))
    ?.status;

const counts = () =>
  one<{ grns: number; grn_lines: number; moves: number }>(
    `select (select count(*)::int from public.grns) as grns,
            (select count(*)::int from public.grn_lines) as grn_lines,
            (select count(*)::int from public.stock_moves where move_type = 'grn') as moves`,
  );

async function oilCard(reg: string, qty: number, neededBy?: string, model = M.splendor, variant = V.splendorDrum) {
  const card = await createBikeAs(ncrManager, reg, model, variant, [{ finding_type_id: FT.oil, qty }]);
  const confirmed = await confirmAs(ncrManager, card.card_id);
  if (neededBy) {
    await db.query(`update public.job_cards set needed_by = $2 where id = $1`, [card.card_id, neededBy]);
  }
  return confirmed;
}

const generate = async () =>
  expectOk<{ added: number; changed: number; removed: number }>(
    await rpc(ncrManager, "generate_draft_pos", { p_workshop_id: null }),
  );

beforeAll(async () => {
  db = await pgClient();
  ncrManager = await clientAs("ncr_manager");
  ncrStore = await clientAs("ncr_store");
  jprManager = await clientAs("jpr_manager");
  jprStore = await clientAs("jpr_store");
});

beforeEach(async () => {
  await testClear(db);
  await insertBins(db, "NCR");
  await insertBins(db, "JPR");
  await insertJobCardCatalog(db);
  await insertPurchasingCatalog(db);
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

describe("receive_grn (SPEC §7.4)", () => {
  it("accepts received − damaged − wrong into receiving and keeps rejected units owed", async () => {
    const po = await sendPo([{ part: P.oil, qty: 10 }]);
    const res = expectOk<GrnResult>(
      await receive(po, [lineIn(po, "T-OIL", 10, { qty_damaged: 2, qty_wrong_part: 1 })]),
    );

    expect(res.grn).toMatchObject({ code: "GRN-NCR-000001", po_status: "partially_received" });
    expect(res.grn.lines).toEqual([
      expect.objectContaining({ sku: "T-OIL", qty_received: 10, qty_accepted: 7, qty_damaged: 2, qty_wrong_part: 1 }),
    ]);
    expect(await poLine(po, "T-OIL")).toEqual({ qty_accepted: 7, qty_rejected: 3, qty_cancelled: 0, open_qty: 3 });
    expect(await poStatus(po)).toBe("partially_received");

    const moves = (
      await db.query(`select move_type::text, qty, to_bin_id, grn_line_id is not null as linked from public.stock_moves`)
    ).rows;
    expect(moves).toEqual([{ move_type: "grn", qty: 7, to_bin_id: ncr.rcv, linked: true }]);
  });

  it("refuses an over-receipt with detail and posts nothing", async () => {
    const po = await sendPo([
      { part: P.oil, qty: 10 },
      { part: P.air, qty: 5 },
    ]);
    expectOk(await receive(po, [lineIn(po, "T-OIL", 7)]));
    const before = await counts();

    // The air filter line is fine; the oil line is over by one: the whole GRN is refused.
    const res = await receive(po, [lineIn(po, "T-AIR", 5), lineIn(po, "T-OIL", 4)]);
    expectCode(res, "OVER_RECEIPT");
    expect(detail(res)).toMatchObject({ part: "T-OIL", ordered: 10, accepted_so_far: 7, max_now: 3 });
    expect(await counts()).toEqual(before);
    expect(await poLine(po, "T-AIR")).toMatchObject({ qty_accepted: 0, open_qty: 5 });

    // Damaged units do not count against the open qty.
    expectOk(await receive(po, [lineIn(po, "T-OIL", 5, { qty_damaged: 2 })]));
    expect(await poLine(po, "T-OIL")).toMatchObject({ qty_accepted: 10, qty_rejected: 2, open_qty: 0 });
  });

  it("refuses POs that are draft, cancelled or closed (PO_NOT_RECEIVABLE)", async () => {
    const draft = expectOk<Po>(
      await rpc(ncrManager, "add_draft_line", {
        p_workshop_id: null,
        p_supplier_id: SUP.jpr,
        p_part_id: P.oil,
        p_qty: 2,
        p_unit_price_paise: 30000,
      }),
    );
    expectCode(await receive(draft, [lineIn(draft, "T-OIL", 1)]), "PO_NOT_RECEIVABLE");

    const cancelled = await sendPo([{ part: P.oil, qty: 2 }]);
    expectOk(await rpc(ncrManager, "cancel_po", { p_po_id: cancelled.po_id, p_reason: "Supplier out of stock" }));
    expectCode(await receive(cancelled, [lineIn(cancelled, "T-OIL", 1)]), "PO_NOT_RECEIVABLE");

    const closed = await sendPo([{ part: P.air, qty: 4 }]);
    expectOk(await receive(closed, [lineIn(closed, "T-AIR", 1)]));
    expectOk(await rpc(ncrManager, "short_close_po", { p_po_id: closed.po_id, p_line_ids: ALL_LINES, p_reason: "Rest not coming" }));
    expect(await poStatus(closed)).toBe("closed");
    const res = await receive(closed, [lineIn(closed, "T-AIR", 1)]);
    expectCode(res, "PO_NOT_RECEIVABLE");
    expect(detail(res)).toMatchObject({ status: "closed" });
  });

  it("validates lines and the invoice", async () => {
    const po = await sendPo([{ part: P.oil, qty: 10 }]);
    const other = await sendPo([{ part: P.air, qty: 3 }], SUP.jpr);

    const foreign = await receive(po, [{ po_line_id: other.lines[0].line_id, qty_received: 1 }]);
    expectCode(foreign, "VALIDATION");
    expect(detail(foreign)).toMatchObject({ reason: "po_line_not_on_po" });

    const zero = await receive(po, [lineIn(po, "T-OIL", 0)]);
    expectCode(zero, "VALIDATION");
    expect(detail(zero)).toMatchObject({ reason: "nothing_received" });
    expectCode(await receive(po, []), "VALIDATION");

    const repeated = await receive(po, [lineIn(po, "T-OIL", 1), lineIn(po, "T-OIL", 1)]);
    expect(detail(repeated)).toMatchObject({ reason: "repeated_po_line" });
    expectCode(await receive(po, [lineIn(po, "T-OIL", 2, { qty_damaged: 3 })]), "VALIDATION");
    expectCode(await receive(po, [lineIn(po, "T-OIL", 1.5)]), "VALIDATION");
    expectCode(await receive(po, [lineIn(po, "T-OIL", 1, { unit_price_paise: 0 })]), "VALIDATION");

    expectCode(await receive(po, [lineIn(po, "T-OIL", 1)], { invoice: "  " }), "VALIDATION");
    expectCode(await receive(po, [lineIn(po, "T-OIL", 1)], { invoice: "x".repeat(41) }), "VALIDATION");
    const tomorrow = (await one<{ d: string }>(`select (private.ist_today() + 1)::text as d`)).d;
    expectCode(await receive(po, [lineIn(po, "T-OIL", 1)], { date: tomorrow }), "VALIDATION");

    expect(await counts()).toEqual({ grns: 0, grn_lines: 0, moves: 0 });
  });

  it("hides another workshop's PO from its store keeper (NOT_FOUND) and refuses unauthorised roles", async () => {
    const po = await sendPo([{ part: P.oil, qty: 2 }]);
    expectCode(await receive(po, [lineIn(po, "T-OIL", 1)], { as: jprStore }), "NOT_FOUND");
    expectCode(await receive(po, [lineIn(po, "T-OIL", 1)], { as: jprManager }), "NOT_FOUND");
    // A manager can do everything a store keeper can, in their own workshop.
    expectOk(await receive(po, [lineIn(po, "T-OIL", 1)], { as: ncrManager }));
  });

  it("rejects a duplicate invoice in the same financial year unless allowed", async () => {
    const po = await sendPo([{ part: P.oil, qty: 10 }]);
    expectOk(await receive(po, [lineIn(po, "T-OIL", 1)], { invoice: "INV/001", date: "2026-04-01" }));

    // Same supplier, same normalised number, same April–March year.
    const dup = await receive(po, [lineIn(po, "T-OIL", 1)], { invoice: "inv-001", date: "2026-09-15" });
    expectCode(dup, "DUPLICATE_INVOICE");
    expect(detail(dup)).toMatchObject({
      grn_code: "GRN-NCR-000001",
      received_by: "00000000-0000-0000-0000-0000000000b2",
      invoice_date: "2026-04-01",
    });
    expect(detail(dup).received_by_name).toBeTruthy();
    expect(detail(dup).received_at).toBeTruthy();

    expectOk(await receive(po, [lineIn(po, "T-OIL", 1)], { invoice: "inv-001", date: "2026-09-15", allowDup: true }));
    // The previous financial year (31 March) is a different invoice.
    expectOk(await receive(po, [lineIn(po, "T-OIL", 1)], { invoice: "INV 001", date: "2026-03-31" }));
    // Another supplier may use the same number.
    const other = await sendPo([{ part: P.air, qty: 2 }], SUP.jpr);
    expectOk(await receive(other, [lineIn(other, "T-AIR", 1)], { invoice: "INV/001", date: "2026-04-01" }));
  });

  it("allocates accepted units FIFO to waiting lines and returns the allocations", async () => {
    // Created out of FIFO order on purpose; needed_by decides.
    const late = await oilCard("DL1 AB 0025", 2, "2026-10-25");
    const first = await oilCard("DL1 AB 0021", 1, "2026-10-21");
    const second = await oilCard("DL1 AB 0022", 2, "2026-10-22");
    // A cancelled line and a draft card's line never get stock.
    const dropped = await oilCard("DL1 AB 0020", 3, "2026-10-20");
    expectOk(
      await rpc(ncrManager, "set_line_qty", { p_line_id: dropped.lines[0].line_id, p_qty: 0, p_reason: "Not needed" }),
    );
    await createBikeAs(ncrManager, "DL1 AB 0019", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil, qty: 4 }]);
    // One bike is already at the workshop, so it has a waiting_since.
    expectOk(await rpc(ncrStore, "mark_arrived", { p_bike_id: first.bike_id }));

    const po = await sendPo([{ part: P.oil, qty: 5 }]);
    const res = expectOk<GrnResult>(await receive(po, [lineIn(po, "T-OIL", 5)]));

    expect(res.allocations.map(({ reg_no, card_code, part, qty }) => ({ reg_no, card_code, part, qty }))).toEqual([
      { reg_no: "DL1 AB 0021", card_code: first.code, part: "T-OIL", qty: 1 },
      { reg_no: "DL1 AB 0022", card_code: second.code, part: "T-OIL", qty: 2 },
      { reg_no: "DL1 AB 0025", card_code: late.code, part: "T-OIL", qty: 2 },
    ]);
    expect(res.allocations[0].waiting_since).not.toBeNull();
    expect(res.allocations[1].waiting_since).toBeNull();

    const reserved = (
      await db.query(
        `select c.code, l.qty_reserved, l.cancelled_at is not null as cancelled
         from public.job_card_lines l join public.job_cards c on c.id = l.job_card_id order by c.code`,
      )
    ).rows;
    expect(reserved.filter((r) => r.qty_reserved > 0).map((r) => [r.code, r.qty_reserved])).toEqual(
      [
        [late.code, 2],
        [first.code, 1],
        [second.code, 2],
      ].sort(),
    );
    expect(
      await one(`select available, shortfall from private.stock_position($1, array[$2::uuid])`, [NCR, P.oil]),
    ).toEqual({ available: 0, shortfall: 0 });
  });

  it("stores the invoice price, flags a 5% variance and updates the last price; emergency buys never do", async () => {
    const card: Card = await oilCard("DL1 AC 0001", 1);
    const po = await sendPo([{ part: P.oil, qty: 10, price: 32000 }]);

    const small = expectOk<GrnResult>(await receive(po, [lineIn(po, "T-OIL", 5, { unit_price_paise: 33000 })]));
    expect(small.grn.lines[0]).toMatchObject({ unit_price_paise: 33000, po_unit_price_paise: 32000, price_variance: false });
    const big = expectOk<GrnResult>(await receive(po, [lineIn(po, "T-OIL", 5, { unit_price_paise: 35000 })]));
    expect(big.grn.lines[0]).toMatchObject({ unit_price_paise: 35000, price_variance: true });

    const lastPrice = async () =>
      (await one<{ p: number }>(`select unit_price_paise::int as p from public.v_part_last_price where part_id = $1`, [P.oil]))
        .p;
    expect(await lastPrice()).toBe(35000);
    // The PO keeps its own price.
    expect((await poLines())[0]).toMatchObject({ unit_price_paise: 32000 });

    // An emergency buy at a much higher price (inserted as postgres; the RPC comes later).
    const buy = await one<{ id: string }>(
      `insert into public.emergency_buys
         (workshop_id, job_card_line_id, part_id, vendor_name, qty, unit_price_paise, qty_issued, qty_to_stock, reason, bought_by)
       values ($1, $2, $3, 'Local shop', 1, 99900, 0, 1, 'no_stock', '00000000-0000-0000-0000-0000000000b2')
       returning id`,
      [NCR, card.lines[0].line_id, P.oil],
    );
    await db.query(
      `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, emergency_buy_id, user_id)
       values ($1, $2, 'emergency_in', 1, $3, $4, '00000000-0000-0000-0000-0000000000b2')`,
      [NCR, P.oil, ncr.rcv, buy.id],
    );
    expect(await lastPrice()).toBe(35000);
  });
});

describe("PO status, short-close and cancel (SPEC §7.5)", () => {
  it("derives received when every line is fully accepted", async () => {
    const po = await sendPo([
      { part: P.oil, qty: 3 },
      { part: P.air, qty: 2 },
    ]);
    expectOk(await receive(po, [lineIn(po, "T-OIL", 3)]));
    expect(await poStatus(po)).toBe("partially_received");
    const res = expectOk<GrnResult>(await receive(po, [lineIn(po, "T-AIR", 2)]));
    expect(res.grn.po_status).toBe("received");
  });

  it("derives closed after a partial receipt is short-closed", async () => {
    const po = await sendPo([{ part: P.oil, qty: 5 }]);
    expectOk(await receive(po, [lineIn(po, "T-OIL", 2)]));
    const res = expectOk<Po>(
      await rpc(ncrManager, "short_close_po", { p_po_id: po.po_id, p_line_ids: ALL_LINES, p_reason: "Supplier short" }),
    );
    expect(res.status).toBe("closed");
    expect(await poLine(po, "T-OIL")).toMatchObject({ qty_accepted: 2, qty_cancelled: 3, open_qty: 0 });
  });

  it("derives cancelled when everything is short-closed with nothing received", async () => {
    const po = await sendPo([{ part: P.oil, qty: 5 }]);
    expectOk(await rpc(ncrManager, "short_close_po", { p_po_id: po.po_id, p_line_ids: ALL_LINES, p_reason: "Not coming" }));
    expect(
      await one(`select status::text, cancel_reason from public.purchase_orders where id = $1`, [po.po_id]),
    ).toEqual({ status: "cancelled", cancel_reason: "Not coming" });
  });

  it("stays sent after a rejected-only GRN", async () => {
    const po = await sendPo([{ part: P.oil, qty: 5 }]);
    const res = expectOk<GrnResult>(await receive(po, [lineIn(po, "T-OIL", 2, { qty_damaged: 1, qty_wrong_part: 1 })]));
    expect(res.grn.po_status).toBe("sent");
    expect(res.allocations).toEqual([]);
    expect(await poLine(po, "T-OIL")).toEqual({ qty_accepted: 0, qty_rejected: 2, qty_cancelled: 0, open_qty: 5 });
    expect((await counts()).moves).toBe(0);
  });

  it("short-closes only the chosen lines", async () => {
    const po = await sendPo([
      { part: P.oil, qty: 4 },
      { part: P.air, qty: 3 },
    ]);
    const air = po.lines.find((l) => l.sku === "T-AIR")!.line_id;
    expectOk(await rpc(ncrManager, "short_close_po", { p_po_id: po.po_id, p_line_ids: [air], p_reason: "Discontinued" }));
    expect(await poStatus(po)).toBe("sent");
    expect(await poLine(po, "T-AIR")).toMatchObject({ qty_cancelled: 3, open_qty: 0 });

    const res = expectOk<GrnResult>(await receive(po, [lineIn(po, "T-OIL", 4)]));
    expect(res.grn.po_status).toBe("closed");

    // Nothing open any more.
    expectCode(
      await rpc(ncrManager, "short_close_po", { p_po_id: po.po_id, p_line_ids: ALL_LINES, p_reason: "Again" }),
      "VALIDATION",
    );
  });

  it("validates short-close input and roles", async () => {
    const po = await sendPo([{ part: P.oil, qty: 4 }]);
    const other = await sendPo([{ part: P.air, qty: 1 }], SUP.jpr);
    const draft = expectOk<Po>(
      await rpc(ncrManager, "add_draft_line", { p_workshop_id: null, p_supplier_id: SUP.jpr, p_part_id: P.oil, p_qty: 1 }),
    );

    expectCode(await rpc(ncrManager, "short_close_po", { p_po_id: po.po_id, p_line_ids: ALL_LINES, p_reason: " " }), "VALIDATION");
    expectCode(
      await rpc(ncrManager, "short_close_po", { p_po_id: po.po_id, p_line_ids: [other.lines[0].line_id], p_reason: "x" }),
      "VALIDATION",
    );
    expectCode(
      await rpc(ncrManager, "short_close_po", { p_po_id: draft.po_id, p_line_ids: ALL_LINES, p_reason: "x" }),
      "VALIDATION",
    );
    expectCode(await rpc(ncrStore, "short_close_po", { p_po_id: po.po_id, p_line_ids: ALL_LINES, p_reason: "x" }), "FORBIDDEN");
    expectCode(await rpc(jprManager, "short_close_po", { p_po_id: po.po_id, p_line_ids: ALL_LINES, p_reason: "x" }), "NOT_FOUND");
    expectCode(await rpc(jprManager, "cancel_po", { p_po_id: po.po_id, p_reason: "x" }), "NOT_FOUND");
  });

  it("cancels a draft by deleting it, a sent PO with nothing accepted, and refuses once anything was accepted", async () => {
    const draft = expectOk<Po>(
      await rpc(ncrManager, "add_draft_line", { p_workshop_id: null, p_supplier_id: SUP.jpr, p_part_id: P.oil, p_qty: 1 }),
    );
    expect(expectOk(await rpc(ncrManager, "cancel_po", { p_po_id: draft.po_id, p_reason: "Mistake" }))).toMatchObject({
      status: "deleted",
    });
    expect(await poStatus(draft)).toBeUndefined();

    // A rejected-only receipt accepted nothing, so the PO can still be cancelled.
    const sent = await sendPo([{ part: P.oil, qty: 3 }]);
    expectOk(await receive(sent, [lineIn(sent, "T-OIL", 1, { qty_damaged: 1 })]));
    const cancelled = expectOk<Po>(await rpc(ncrManager, "cancel_po", { p_po_id: sent.po_id, p_reason: "Wrong supplier" }));
    expect(cancelled.status).toBe("cancelled");
    expect(await poLine(sent, "T-OIL")).toMatchObject({ qty_cancelled: 3, open_qty: 0 });
    expectCode(await rpc(ncrManager, "cancel_po", { p_po_id: sent.po_id, p_reason: "Again" }), "VALIDATION");

    const partial = await sendPo([{ part: P.oil, qty: 3 }]);
    expectOk(await receive(partial, [lineIn(partial, "T-OIL", 1)]));
    expectCode(await rpc(ncrManager, "cancel_po", { p_po_id: partial.po_id, p_reason: "Too late" }), "ALREADY_RECEIVED");
  });
});

describe("open supply and regeneration (SPEC §7.1, §4)", () => {
  it("does not reorder a shortfall covered by a sent PO, even overdue, and reorders after short-close", async () => {
    await oilCard("DL1 AD 0001", 2, undefined, M.classic, V.classic);
    const po = await sendPo([{ part: P.reOil, qty: 2, price: 50000 }]);
    await db.query(`update public.purchase_orders set expected_on = private.ist_today() - 3 where id = $1`, [po.po_id]);

    expect(await generate()).toMatchObject({ added: 0 });
    expect(await one(`select on_order, order_qty from private.po_requirements($1, private.ist_today()) where part_id = $2`, [
      NCR,
      P.reOil,
    ])).toEqual({ on_order: 2, order_qty: 0 });

    expectOk(await rpc(ncrManager, "short_close_po", { p_po_id: po.po_id, p_line_ids: ALL_LINES, p_reason: "Not coming" }));
    expect(await poStatus(po)).toBe("cancelled");
    expect(await generate()).toMatchObject({ added: 1 });
    expect((await poLines()).find((l) => l.status === "draft")).toMatchObject({ sku: "T-OIL-RE", qty_ordered: 2 });
  });
});

describe("v_line_eta (SPEC §7.6)", () => {
  type Eta = {
    reg_no: string;
    eta_status: string;
    po_code: string | null;
    expected_on: string | null;
    is_overdue: boolean;
    uncovered: number;
  };
  const etas = async (c: Client = ncrManager) => {
    const { data, error } = await c
      .from("v_line_eta")
      .select("reg_no, eta_status, po_code, expected_on, is_overdue, uncovered")
      .order("reg_no");
    expect(error).toBeNull();
    return data as Eta[];
  };

  it("pegs waiting lines to POs in FIFO order by running totals", async () => {
    await oilCard("DL1 AE 0001", 1, "2026-10-20");
    await oilCard("DL1 AE 0002", 1, "2026-10-21");
    await oilCard("DL1 AE 0003", 1, "2026-10-23");

    // PO-B is created first but due later; PO-A (2 units) is overdue.
    const poB = await sendPo([{ part: P.oil, qty: 1 }]);
    const poA = await sendPo([{ part: P.oil, qty: 2 }]);
    const dates = await one<{ a: string; b: string }>(
      `select (private.ist_today() - 1)::text as a, (private.ist_today() + 4)::text as b`,
    );
    await db.query(`update public.purchase_orders set expected_on = $2 where id = $1`, [poA.po_id, dates.a]);
    await db.query(`update public.purchase_orders set expected_on = $2 where id = $1`, [poB.po_id, dates.b]);

    expect(await etas()).toEqual([
      { reg_no: "DL1 AE 0001", eta_status: "on_po", po_code: poA.code, expected_on: dates.a, is_overdue: true, uncovered: 1 },
      { reg_no: "DL1 AE 0002", eta_status: "on_po", po_code: poA.code, expected_on: dates.a, is_overdue: true, uncovered: 1 },
      { reg_no: "DL1 AE 0003", eta_status: "on_po", po_code: poB.code, expected_on: dates.b, is_overdue: false, uncovered: 1 },
    ]);

    // A fourth bike is not covered by any PO; then a draft covers it.
    await oilCard("DL1 AE 0004", 1, "2026-10-24");
    expect((await etas())[3]).toMatchObject({ eta_status: "not_ordered", po_code: null, expected_on: null });
    const draft = expectOk<Po>(
      await rpc(ncrManager, "add_draft_line", { p_workshop_id: null, p_supplier_id: SUP.jpr, p_part_id: P.oil, p_qty: 1 }),
    );
    expect((await etas())[3]).toMatchObject({ eta_status: "in_draft", po_code: draft.code, expected_on: null });

    // Jaipur sees none of it.
    expect(await etas(jprManager)).toEqual([]);
  });
});

describe("v_excess_on_order (SPEC §7.7)", () => {
  const excess = async (c: Client = ncrManager) => {
    const { data, error } = await c.from("v_excess_on_order").select("sku, on_order, target, excess");
    expect(error).toBeNull();
    return data;
  };

  it("lists supply left over after demand disappears, never what generation just suggested", async () => {
    // Auto part: generation suggests up to max(max_qty, ROP + 1); sending it is not excess.
    await db.query(
      `insert into public.reorder_settings (workshop_id, part_id, auto, safety_stock, max_qty) values ($1, $2, true, 2, 5)`,
      [NCR, P.air],
    );
    await generate();
    const draft = (await poLines()).find((l) => l.sku === "T-AIR")!;
    expectOk(await rpc(ncrManager, "send_po", { p_po_id: draft.po_id }));
    expect(await excess()).toEqual([]);

    // On-demand part ordered for a bike whose card is then cancelled.
    const card = await oilCard("DL1 AF 0001", 3, undefined, M.classic, V.classic);
    await sendPo([{ part: P.reOil, qty: 3, price: 50000 }]);
    expect(await excess()).toEqual([]);
    expectOk(await rpc(ncrManager, "cancel_job_card", { p_card_id: card.card_id, p_reason: "Bike sold as is" }));
    expect(await excess()).toEqual([{ sku: "T-OIL-RE", on_order: 3, target: 0, excess: 3 }]);
    expect(await excess(jprManager)).toEqual([]);
  });
});
