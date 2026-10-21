// Purchasing part A (SPEC §7.1-7.3, §10): requirement formula, draft generation, draft edits,
// send_po and set_po_expected_on, acting as the demo users. Demand comes from confirmed job cards
// (create_bike + confirm_job_card); issue history is inserted as postgres with explicit times.
// SPEC §17's "two generate_draft_pos" is the one concurrency test here (P14).
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clientAs, pgClient, type Client } from "./clients";
import { insertBins, testClear } from "./fixtures";
import { expectInvariantsHold } from "./invariants";
import { insertPurchasingCatalog, insertReorder, poLines as poLinesOf, SUP, type Po, type PoLine } from "./purchasing-fixtures";
import {
  confirmAs,
  createBikeAs,
  detail,
  expectCode,
  expectOk,
  FT,
  id,
  insertJobCardCatalog,
  JPR,
  M,
  manager,
  ncr,
  NCR,
  P,
  queryOne,
  rpc,
  stockIn as stockInAs,
  V,
  type Card,
} from "./job-card-fixtures";

let db: pg.Client;
let ncrManager: Client;
let ncrStore: Client;
let jprManager: Client;
let admin: Client;

type Req = {
  part_id: string;
  usable_on_hand: number;
  on_order: number;
  outstanding_demand: number;
  projected: number;
  avg_daily_issue_28d: string;
  lead_time_days: number;
  rop: number | null;
  order_qty: number;
  effective_supplier_id: string | null;
  is_auto: boolean;
  enough_history: boolean;
};
type GenResult = {
  added: number;
  changed: number;
  removed: number;
  unsourced: { part_id: string; sku: string; qty: number }[];
  drafts: { po_id: string; code: string; supplier_id: string; lines: PoLine[] }[];
};

const one = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => queryOne<T>(db, sql, params);
const stockIn = (qty: number, part: string = P.oil) => stockInAs(db, qty, part, ncr.normal);

async function oilCard(reg: string, qty: number, model = M.splendor, variant = V.splendorDrum): Promise<Card> {
  const card = await createBikeAs(ncrManager, reg, model, variant, [{ finding_type_id: FT.oil, qty }]);
  return confirmAs(ncrManager, card.card_id);
}

const reorder = (part: string, ws: string, auto: boolean, safety: number, max: number, supplier: string | null = null) =>
  insertReorder(db, part, ws, auto, safety, max, supplier);

async function requirement(part: string, ws: string = NCR, asOf: string | null = null): Promise<Req | undefined> {
  return (
    await db.query<Req>(
      `select * from private.po_requirements($1, coalesce($2::date, private.ist_today())) where part_id = $3`,
      [ws, asOf, part],
    )
  ).rows[0];
}

const generate = async (c: Client = ncrManager) =>
  expectOk<GenResult>(await rpc(c, "generate_draft_pos", { p_workshop_id: null }));

const poLines = (ws: string = NCR) => poLinesOf(db, ws);

const lineFor = async (sku: string, ws: string = NCR) => (await poLines(ws)).find((l) => l.sku === sku);

/** Fixed demand used by most tests (SPEC test 5 numbers):
 *  oil (auto, safety 6, max 20): usable 4 all reserved + 3 more needed → order 23;
 *  RE oil (model_specific, no settings): shortfall 2 → order 2. */
async function standardDemand() {
  await reorder(P.oil, NCR, true, 6, 20);
  await stockIn(4);
  await oilCard("DL1 AA 0001", 4);
  await oilCard("DL1 AA 0002", 3);
  await oilCard("DL1 AA 0003", 2, M.classic, V.classic);
}

beforeAll(async () => {
  db = await pgClient();
  ncrManager = await clientAs("ncr_manager");
  ncrStore = await clientAs("ncr_store");
  jprManager = await clientAs("jpr_manager");
  admin = await clientAs("admin");
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

describe("requirement formula (SPEC §7.1)", () => {
  it("orders an auto part up to max from a negative projection, and a model-specific shortfall exactly", async () => {
    await standardDemand();

    expect(await requirement(P.oil)).toMatchObject({
      usable_on_hand: 4,
      on_order: 0,
      outstanding_demand: 7,
      projected: -3,
      rop: 6,
      order_qty: 23,
      is_auto: true,
      enough_history: false,
      effective_supplier_id: SUP.ncr,
      lead_time_days: 3,
    });
    expect(await requirement(P.reOil)).toMatchObject({ projected: -2, rop: null, order_qty: 2, is_auto: false });

    const res = await generate();
    expect(res).toMatchObject({ added: 2, changed: 0, removed: 0, unsourced: [] });
    expect(await lineFor("T-OIL")).toMatchObject({
      status: "draft",
      supplier_id: SUP.ncr,
      qty_ordered: 23,
      unit_price_paise: 32000,
      source: "suggested",
    });
    expect(await lineFor("T-OIL-RE")).toMatchObject({ qty_ordered: 2, unit_price_paise: 50000 });
    // One draft for the supplier, with a PO code.
    expect(res.drafts).toHaveLength(1);
    expect(res.drafts[0].code).toBe("PO-NCR-000001");
  });

  it("treats a model-specific part as on-demand even with auto reorder settings", async () => {
    await reorder(P.reOil, NCR, true, 5, 10);
    expect(await requirement(P.reOil)).toMatchObject({ is_auto: false, order_qty: 0, rop: null });
  });

  it("counts only sent open qty and manual draft lines as on_order", async () => {
    await standardDemand();
    await db.query(
      `insert into public.purchase_orders (id, workshop_id, code, supplier_id, status, sent_at, expected_on)
       values ($1, $2, 'PO-NCR-000900', $3, 'sent', now() - interval '9 days', private.ist_today() - 2)`,
      [id(61), NCR, SUP.jpr],
    );
    await db.query(
      `insert into public.po_lines (workshop_id, po_id, part_id, qty_ordered, unit_price_paise, source)
       values ($1, $2, $3, 5, 30000, 'suggested')`,
      [NCR, id(61), P.oil],
    );
    // Overdue sent PO still counts; generation's own suggested draft lines do not.
    await generate();
    expect(await requirement(P.oil)).toMatchObject({ on_order: 5, projected: 2, order_qty: 18 });
  });

  it("averages 28 complete IST days of net issues as numeric (15 issued, lead 3, safety 2 → ROP 4)", async () => {
    const asOf = "2026-09-30";
    await reorder(P.oil, NCR, true, 2, 20);
    await stockIn(19);
    const card = await oilCard("DL1 AA 0010", 19);
    const lineId = card.lines[0].line_id;

    const at = (daysBefore: number, time = "10:00") =>
      `(($1::date - ${daysBefore}) + time '${time}') at time zone 'Asia/Kolkata'`;
    const issue = (qty: number, daysBefore: number, time?: string) =>
      db.query(
        `insert into public.stock_moves (workshop_id, part_id, move_type, qty, from_bin_id, job_card_line_id, user_id, created_at)
         values ($2, $3, 'issue', $4, $5, $6, $7, ${at(daysBefore, time)})`,
        [asOf, NCR, P.oil, qty, ncr.normal, lineId, manager],
      );
    // In the window (as_of − 28 .. as_of − 1): 3+3+3+3+3+2 issued, 2 returned → net 15.
    await issue(3, 28, "00:05");
    await issue(3, 21);
    await issue(3, 14);
    await issue(3, 7);
    await issue(3, 3);
    await issue(2, 1, "23:55");
    await db.query(
      `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, job_card_line_id, reason, user_id, created_at)
       values ($2, $3, 'return_to_stock', 2, $4, $5, 'not_needed', $6, ${at(2)})`,
      [asOf, NCR, P.oil, ncr.normal, lineId, manager],
    );
    // Outside the window: the day before it and as_of itself.
    await issue(1, 29);
    await issue(1, 0);
    await db.query(
      `update public.job_card_lines set qty_reserved = 0, qty_issued = 19, qty_returned = 2, qty_required = 17 where id = $1`,
      [lineId],
    );

    const req = (await requirement(P.oil, NCR, asOf))!;
    expect(req).toMatchObject({ rop: 4, enough_history: true, lead_time_days: 3 });
    expect(Number(req.avg_daily_issue_28d)).toBeCloseTo(15 / 28, 10);
    // usable 2, no demand → projected 2 <= 4 → order max(20, 5) − 2.
    expect(req.order_qty).toBe(18);

    // Three days after the first issue there are fewer than 7 complete days: ROP = safety stock.
    const early = (await db.query<{ d: string }>(`select ($1::date - 26)::text as d`, [asOf])).rows[0].d;
    expect(await requirement(P.oil, NCR, early)).toMatchObject({ rop: 2, enough_history: false });
  });

  it("is readable through public.reorder_suggestions for the caller's workshop only", async () => {
    await standardDemand();
    const { data, error } = await ncrManager.rpc("reorder_suggestions", { p_workshop_id: NCR });
    expect(error).toBeNull();
    const oil = data!.find((r) => r.sku === "T-OIL");
    expect(oil).toMatchObject({ order_qty: 23, rop: 6, projected: -3 });

    const jpr = await jprManager.rpc("reorder_suggestions", { p_workshop_id: NCR });
    expect(jpr.error).toBeNull();
    expect(jpr.data).toEqual([]);
  });
});

describe("generate_draft_pos (SPEC §7.1)", () => {
  it("is idempotent: a second run keeps the same POs and lines and reports no changes", async () => {
    await standardDemand();
    const first = await generate();
    expect(first.added).toBe(2);
    const before = await poLines();

    const second = await generate();
    expect(second).toMatchObject({ added: 0, changed: 0, removed: 0, unsourced: [] });
    expect(await poLines()).toEqual(before);
    expect(second.drafts.map((d) => d.po_id)).toEqual(first.drafts.map((d) => d.po_id));
  });

  it("SPEC §17: two concurrent runs leave the same POs and lines as one run", async () => {
    await standardDemand();
    // The manager and admin press "Generate draft POs" for NCR at the same moment.
    const [a, b] = await Promise.all([
      generate(),
      rpc(admin, "generate_draft_pos", { p_workshop_id: NCR }).then((r) => expectOk<GenResult>(r)),
    ]);
    // The workshop lock serialises them: one adds both lines, the other finds nothing to change.
    expect([a.added, b.added].sort()).toEqual([0, 2]);
    expect(a.changed + b.changed + a.removed + b.removed).toBe(0);
    const lines = await poLines();
    expect(lines.map((l) => [l.sku, l.qty_ordered]).sort()).toEqual([
      ["T-OIL", 23],
      ["T-OIL-RE", 2],
    ]);
    const { rows } = await db.query(
      `select supplier_id, count(*)::int as n from public.purchase_orders
       where workshop_id = $1 and status = 'draft' group by supplier_id having count(*) > 1`,
      [NCR],
    );
    expect(rows).toEqual([]);
    expect(await generate()).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(await poLines()).toEqual(lines);
  });

  it("updates a suggested line when demand changes and removes it (and the empty draft) when demand is gone", async () => {
    await standardDemand();
    const first = await generate();
    const poId = first.drafts[0].po_id;

    await oilCard("DL1 AA 0004", 2);
    expect(await generate()).toMatchObject({ added: 0, changed: 1, removed: 0 });
    expect(await lineFor("T-OIL")).toMatchObject({ po_id: poId, qty_ordered: 25 });

    // Everything arrives: no demand is left and stock sits above the reorder point.
    await stockIn(30);
    await stockIn(2, P.reOil);
    await db.query(`select private.allocate_free_stock($1, $2)`, [NCR, P.oil]);
    await db.query(`select private.allocate_free_stock($1, $2)`, [NCR, P.reOil]);
    expect(await generate()).toMatchObject({ added: 0, changed: 0, removed: 2 });
    expect(await poLines()).toEqual([]);
  });

  it("refuses a store keeper and needs a workshop for admin", async () => {
    expectCode(await rpc(ncrStore, "generate_draft_pos", { p_workshop_id: null }), "FORBIDDEN");
    expectCode(await rpc(admin, "generate_draft_pos", { p_workshop_id: null }), "WORKSHOP_REQUIRED");
    expectCode(await rpc(jprManager, "generate_draft_pos", { p_workshop_id: NCR }), "NOT_FOUND");
    expectOk(await rpc(admin, "generate_draft_pos", { p_workshop_id: NCR }));
  });
});

describe("draft edits (SPEC §7.2)", () => {
  it("keeps a manually edited line through regeneration and counts it as on order", async () => {
    await standardDemand();
    await generate();
    const oil = (await lineFor("T-OIL"))!;

    const res = expectOk<Po>(
      await rpc(ncrManager, "update_draft_line", { p_line_id: oil.line_id, p_qty: 10, p_unit_price_paise: 30000 }),
    );
    expect(res.lines.find((l) => l.sku === "T-OIL")).toMatchObject({ qty_ordered: 10, source: "manual" });

    // usable 4 + manual 10 − demand 7 = 7 > ROP 6: nothing more is ordered, the manual line stays.
    expect(await generate()).toMatchObject({ added: 0, changed: 0, removed: 0 });
    const oilLines = (await poLines()).filter((l) => l.sku === "T-OIL");
    expect(oilLines).toEqual([
      expect.objectContaining({ line_id: oil.line_id, qty_ordered: 10, unit_price_paise: 30000, source: "manual" }),
    ]);
  });

  it("brings a removed suggested line back while the demand remains", async () => {
    await standardDemand();
    await generate();
    const re = (await lineFor("T-OIL-RE"))!;

    expectOk(await rpc(ncrManager, "remove_draft_line", { p_line_id: re.line_id }));
    expect(await lineFor("T-OIL-RE")).toBeUndefined();

    expect(await generate()).toMatchObject({ added: 1, changed: 0, removed: 0 });
    expect(await lineFor("T-OIL-RE")).toMatchObject({ qty_ordered: 2, source: "suggested", po_id: re.po_id });
  });

  it("adds a manual line on a new or existing draft and refuses a part already on it", async () => {
    const added = expectOk<Po & { line_id: string }>(
      await rpc(ncrManager, "add_draft_line", {
        p_workshop_id: null,
        p_supplier_id: SUP.jpr,
        p_part_id: P.air,
        p_qty: 5,
      }),
    );
    expect(added).toMatchObject({ status: "draft", code: "PO-NCR-000001" });
    expect(added.lines).toEqual([expect.objectContaining({ sku: "T-AIR", qty_ordered: 5, unit_price_paise: null, source: "manual" })]);

    const second = expectOk<Po>(
      await rpc(ncrManager, "add_draft_line", {
        p_workshop_id: NCR,
        p_supplier_id: SUP.jpr,
        p_part_id: P.oil,
        p_qty: 2,
        p_unit_price_paise: 31000,
      }),
    );
    expect(second.po_id).toBe(added.po_id);

    const dup = await rpc(ncrManager, "add_draft_line", {
      p_workshop_id: null,
      p_supplier_id: SUP.jpr,
      p_part_id: P.air,
      p_qty: 1,
    });
    expectCode(dup, "VALIDATION");
    expect(detail(dup)).toMatchObject({ reason: "already_on_po" });

    expectCode(
      await rpc(ncrManager, "add_draft_line", { p_workshop_id: null, p_supplier_id: SUP.jpr, p_part_id: P.pad, p_qty: 0 }),
      "VALIDATION",
    );
    expectCode(
      await rpc(ncrManager, "update_draft_line", { p_line_id: added.line_id, p_qty: 3, p_unit_price_paise: 0 }),
      "VALIDATION",
    );
    expectCode(
      await rpc(ncrManager, "add_draft_line", { p_workshop_id: null, p_supplier_id: id(99), p_part_id: P.pad, p_qty: 1 }),
      "NOT_FOUND",
    );
  });

  it("hides another workshop's draft lines (NOT_FOUND) and refuses store keepers", async () => {
    const added = expectOk<Po & { line_id: string }>(
      await rpc(ncrManager, "add_draft_line", { p_workshop_id: null, p_supplier_id: SUP.ncr, p_part_id: P.oil, p_qty: 5 }),
    );
    expectCode(
      await rpc(jprManager, "update_draft_line", { p_line_id: added.line_id, p_qty: 3, p_unit_price_paise: 30000 }),
      "NOT_FOUND",
    );
    expectCode(await rpc(jprManager, "remove_draft_line", { p_line_id: added.line_id }), "NOT_FOUND");
    expectCode(await rpc(jprManager, "send_po", { p_po_id: added.po_id }), "NOT_FOUND");
    expectCode(await rpc(ncrStore, "remove_draft_line", { p_line_id: added.line_id }), "FORBIDDEN");
    expectCode(
      await rpc(jprManager, "add_draft_line", { p_workshop_id: NCR, p_supplier_id: SUP.ncr, p_part_id: P.air, p_qty: 1 }),
      "NOT_FOUND",
    );
  });
});

describe("supplier choice (SPEC §7.1 step 4)", () => {
  it("lists a part with no supplier as unsourced without creating a line", async () => {
    const card = await createBikeAs(ncrManager, "DL1 AA 0020", M.pulsar, V.pulsarDisc, [{ finding_type_id: FT.brake }]);
    await confirmAs(ncrManager, card.card_id);

    const res = await generate();
    expect(res).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(res.unsourced).toEqual([expect.objectContaining({ part_id: P.pad, sku: "T-PAD", qty: 1 })]);
    expect(await poLines()).toEqual([]);
  });

  it("uses the Jaipur override supplier for Jaipur only", async () => {
    await reorder(P.oil, NCR, true, 2, 5);
    await reorder(P.oil, JPR, true, 3, 10, SUP.jpr);

    expect(await generate(jprManager)).toMatchObject({ added: 1 });
    expect(await generate(ncrManager)).toMatchObject({ added: 1 });

    expect(await lineFor("T-OIL", JPR)).toMatchObject({ supplier_id: SUP.jpr, qty_ordered: 10, code: "PO-JPR-000001" });
    // No supplier_parts price for the Jaipur supplier: falls back to the standard price.
    expect(await lineFor("T-OIL", JPR)).toMatchObject({ unit_price_paise: 35000 });
    expect(await lineFor("T-OIL", NCR)).toMatchObject({ supplier_id: SUP.ncr, qty_ordered: 5, unit_price_paise: 32000 });
  });
});

describe("send_po and expected dates (SPEC §7.3)", () => {
  it("computes expected_on from the IST date of sending", async () => {
    const r = await one<{ d: string; e: string }>(
      `select private.expected_on('2026-10-17T20:00Z', 2)::text as d, private.expected_on('2026-10-17T18:00Z', 2)::text as e`,
    );
    // 20:00Z is 01:30 IST on the 18th; 18:00Z is still the 17th in IST (23:30).
    expect(r).toEqual({ d: "2026-10-20", e: "2026-10-19" });
  });

  it("refuses a PO with a missing price or no lines (PO_NOT_SENDABLE)", async () => {
    const added = expectOk<Po & { line_id: string }>(
      await rpc(ncrManager, "add_draft_line", { p_workshop_id: null, p_supplier_id: SUP.ncr, p_part_id: P.oil, p_qty: 5 }),
    );
    const noPrice = await rpc(ncrManager, "send_po", { p_po_id: added.po_id });
    expectCode(noPrice, "PO_NOT_SENDABLE");
    expect(detail(noPrice)).toMatchObject({ reason: "missing_price", parts: ["T-OIL"] });

    expectOk(await rpc(ncrManager, "remove_draft_line", { p_line_id: added.line_id }));
    const empty = await rpc(ncrManager, "send_po", { p_po_id: added.po_id });
    expectCode(empty, "PO_NOT_SENDABLE");
    expect(detail(empty)).toMatchObject({ reason: "no_lines" });
  });

  it("sends a draft with a WhatsApp text, then freezes it except for expected_on", async () => {
    await standardDemand();
    const gen = await generate();
    const poId = gen.drafts[0].po_id;

    const sent = expectOk<{ po: Po; whatsapp_text: string }>(await rpc(ncrManager, "send_po", { p_po_id: poId }));
    const expected = await one<{ d: string; sent: string }>(
      `select (private.ist_today() + 3)::text as d, status::text as sent from public.purchase_orders where id = $1`,
      [poId],
    );
    expect(sent.po).toMatchObject({ status: "sent", expected_on: expected.d });
    expect(expected.sent).toBe("sent");

    const text = sent.whatsapp_text;
    expect(text).toContain("Purchase order PO-NCR-000001");
    expect(text).toContain("To: Delhi Parts Co");
    expect(text).toContain("T-OIL Engine oil 1L");
    expect(text).toContain("Supplier code: DP-OIL");
    expect(text).toContain("Qty: 23 bottle @ ₹320.00 incl. GST");
    expect(text).toContain("T-OIL-RE Engine oil 1L (RE)");
    expect(text).toContain("Qty: 2 bottle @ ₹500.00 incl. GST");
    expect(text).toContain("Fits: Royal Enfield Classic 350 Reborn 2021–present, disc, self");
    // Only model-specific parts get a fitment line.
    expect(text.match(/Fits:/g)).toHaveLength(1);

    // Sent POs are immutable: line edits are VALIDATION; sending again is PO_NOT_SENDABLE.
    const oil = sent.po.lines.find((l) => l.sku === "T-OIL")!;
    const edit = await rpc(ncrManager, "update_draft_line", { p_line_id: oil.line_id, p_qty: 1, p_unit_price_paise: 1 });
    expectCode(edit, "VALIDATION");
    expect(detail(edit)).toMatchObject({ reason: "po_not_draft" });
    expectCode(await rpc(ncrManager, "remove_draft_line", { p_line_id: oil.line_id }), "VALIDATION");
    expectCode(await rpc(ncrManager, "send_po", { p_po_id: poId }), "PO_NOT_SENDABLE");

    // The sent open qty counts as on order, so regeneration orders nothing more.
    expect(await generate()).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect((await poLines()).every((l) => l.status === "sent")).toBe(true);

    // expected_on: not in the past; today or later is fine.
    const dates = await one<{ past: string; later: string }>(
      `select (private.ist_today() - 1)::text as past, (private.ist_today() + 5)::text as later`,
    );
    expectCode(await rpc(ncrManager, "set_po_expected_on", { p_po_id: poId, p_date: dates.past }), "VALIDATION");
    expect(expectOk<Po>(await rpc(ncrManager, "set_po_expected_on", { p_po_id: poId, p_date: dates.later }))).toMatchObject({
      expected_on: dates.later,
    });
    expectCode(await rpc(jprManager, "set_po_expected_on", { p_po_id: poId, p_date: dates.later }), "NOT_FOUND");
  });

  it("refuses set_po_expected_on on a draft", async () => {
    const added = expectOk<Po>(
      await rpc(ncrManager, "add_draft_line", { p_workshop_id: null, p_supplier_id: SUP.ncr, p_part_id: P.oil, p_qty: 5 }),
    );
    const today = await one<{ d: string }>(`select private.ist_today()::text as d`);
    expectCode(await rpc(ncrManager, "set_po_expected_on", { p_po_id: added.po_id, p_date: today.d }), "VALIDATION");
  });
});
