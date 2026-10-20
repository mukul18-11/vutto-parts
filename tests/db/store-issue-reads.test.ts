// Store counter reads (migration store_issue_reads): v_store_cards (issue queue and return
// finder), v_store_waiting_lines (emergency buy list with ETA), store_home_counts (store tiles)
// and emergency_context (remaining need, reference price, where the stock is). State is built
// through the real RPCs as the demo users; every read runs under RLS.
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseStoreSearch } from "../../src/lib/store";
import { istToday } from "../../src/lib/time";
import { clientAs, pgClient, type Client } from "./clients";
import { insertBins, testClear } from "./fixtures";
import { expectInvariantsHold } from "./invariants";
import {
  arriveAs,
  confirmAs,
  createBikeAs,
  expectOk,
  FT,
  insertJobCardCatalog,
  issueAs,
  lineOf,
  M,
  ncr,
  NCR,
  P,
  queryOne,
  rpc,
  stockIn as stockInAs,
  V,
  type Card,
} from "./job-card-fixtures";
import { insertPurchasingCatalog, insertReorder, sendPo, SUP } from "./purchasing-fixtures";

let db: pg.Client;
let ncrManager: Client;
let ncrStore: Client;
let jprStore: Client;
let jprManager: Client;

const stockIn = (qty: number, part: string = P.oil, bin: string = ncr.normal) => stockInAs(db, qty, part, bin);

async function oilCard(reg: string, qty: number): Promise<Card> {
  const card = await createBikeAs(ncrManager, reg, M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil, qty }]);
  return confirmAs(ncrManager, card.card_id);
}
const oilLine = (c: Card) => lineOf(c, "T-OIL").line_id;

type Ctx = {
  remaining_need: number;
  qty_reserved: number;
  available: number;
  reference_price_paise: number;
  reserved_bins: { code: string; kind: string; on_hand: number }[];
  held_by: { card_code: string; reg_no: string; qty: number }[];
};
async function context(c: Client, line: string): Promise<Ctx[]> {
  const { data, error } = await c.rpc("emergency_context", { p_line_id: line });
  expect(error).toBeNull();
  return (data ?? []) as unknown as Ctx[];
}
async function referenceOf(part: string): Promise<number> {
  return Number((await queryOne<{ p: string }>(db, `select private.reference_price($1, $2) as p`, [NCR, part])).p);
}
async function counts(c: Client, ws: string = NCR) {
  const { data, error } = await c.rpc("store_home_counts", { p_workshop_id: ws });
  expect(error).toBeNull();
  return data?.[0];
}

beforeAll(async () => {
  db = await pgClient();
  ncrManager = await clientAs("ncr_manager");
  ncrStore = await clientAs("ncr_store");
  jprStore = await clientAs("jpr_store");
  jprManager = await clientAs("jpr_manager");
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

describe("v_store_cards and store_home_counts", () => {
  it("lists confirmed cards of arrived bikes with reserved and returnable lines; counts the tiles", async () => {
    await stockIn(1);
    const x = await oilCard("DL3SAS1234", 2); // 1 reserved, 1 uncovered
    await arriveAs(ncrStore, x);
    await oilCard("HR26CD1234", 1); // not arrived: excluded everywhere
    const draft = await createBikeAs(ncrManager, "DL3SAS0003", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil, qty: 1 }]);
    await arriveAs(ncrStore, draft); // draft card: excluded
    await sendPo(ncrManager, [{ part: P.air, qty: 1 }]);
    await stockIn(2, P.air, ncr.rcv);

    const { data: rows } = await ncrStore
      .from("v_store_cards")
      .select("code, reg_no, bike_status, make, model, variant_name, mfg_year, reserved_lines, reserved_qty, returnable_lines, uncovered_lines")
      .order("code");
    expect(rows).toEqual([
      {
        code: x.code,
        reg_no: "DL3SAS1234",
        bike_status: "at_workshop",
        make: "Hero",
        model: "Splendor Plus",
        variant_name: expect.any(String),
        mfg_year: expect.any(Number),
        reserved_lines: 1,
        reserved_qty: 1,
        returnable_lines: 0,
        uncovered_lines: 1,
      },
    ]);
    expect(await counts(ncrStore)).toEqual({ to_receive: 1, to_put_away: 1, ready_to_issue: 1, emergency_waiting: 1 });

    // After the issue the card leaves the issue queue and appears in the return finder.
    expectOk(await issueAs(ncrStore, oilLine(x), ncr.normal, 1));
    const { data: after } = await ncrStore.from("v_store_cards").select("code, reserved_qty, returnable_lines");
    expect(after).toEqual([{ code: x.code, reserved_qty: 0, returnable_lines: 1 }]);
    expect(await counts(ncrStore)).toMatchObject({ ready_to_issue: 0, emergency_waiting: 1 });

    // Another workshop sees nothing, and its counts of NCR are zero (RLS).
    expect((await jprManager.from("v_store_cards").select("code")).data).toEqual([]);
    expect(await counts(jprStore)).toEqual({ to_receive: 0, to_put_away: 0, ready_to_issue: 0, emergency_waiting: 0 });
  });

  it("finds a card by reg-no suffix or normalized job card code", async () => {
    await stockIn(3);
    const a = await oilCard("DL3SAB1234", 1);
    const b = await oilCard("HR26CD1234", 1);
    const c = await oilCard("UP16EF9999", 1);
    for (const card of [a, b, c]) await arriveAs(ncrStore, card);

    const find = async (q: string) => {
      const s = parseStoreSearch(q)!;
      let query = ncrStore.from("v_store_cards").select("code, reg_no");
      if (s.kind === "card") query = query.like("code_norm", s.pattern);
      else query = s.alsoCode ? query.or(`reg_no_norm.like.*${s.suffix},code_norm.like.*${s.suffix}`) : query.like("reg_no_norm", `%${s.suffix}`);
      const { data, error } = await query.order("reg_no");
      expect(error).toBeNull();
      return (data ?? []).map((r) => r.reg_no);
    };
    expect(await find("1234")).toEqual(["DL3SAB1234", "HR26CD1234"]);
    expect(await find("sab1234")).toEqual(["DL3SAB1234"]);
    const num = a.code.slice(-6).replace(/^0+/, "");
    expect(await find(`jc ncr ${num}`)).toEqual(["DL3SAB1234"]);
    expect(await find(a.code)).toEqual(["DL3SAB1234"]);
  });
});

describe("v_store_waiting_lines", () => {
  it("lists uncovered lines on arrived bikes with their ETA", async () => {
    const x = await oilCard("DL3SAW0001", 1);
    await arriveAs(ncrStore, x);
    await oilCard("DL3SAW0002", 1); // purchased: not in the store keeper's list
    const po = await sendPo(ncrManager, [{ part: P.oil, qty: 1 }]);

    const { data } = await ncrStore
      .from("v_store_waiting_lines")
      .select("line_id, card_code, reg_no, bike_status, sku, uncovered, eta_status, po_code, expected_on, is_overdue");
    expect(data).toEqual([
      {
        line_id: oilLine(x),
        card_code: x.code,
        reg_no: "DL3SAW0001",
        bike_status: "at_workshop",
        sku: "T-OIL",
        uncovered: 1,
        eta_status: "on_po",
        po_code: po.code,
        expected_on: po.expected_on,
        is_overdue: false,
      },
    ]);
    expect((await jprStore.from("v_store_waiting_lines").select("line_id")).data).toEqual([]);
  });
});

describe("emergency_context", () => {
  it("gives the remaining need, the bins of this bike's reservation (receiving first) and other holders", async () => {
    await stockIn(1);
    await stockIn(1, P.oil, ncr.rcv);
    const x = await oilCard("DL3SAE0001", 3); // 2 reserved, 1 uncovered
    await arriveAs(ncrStore, x);
    const y = await oilCard("DL3SAE0002", 1); // nothing free
    await arriveAs(ncrStore, y);

    const [cx] = await context(ncrStore, oilLine(x));
    expect(cx).toMatchObject({ remaining_need: 3, qty_reserved: 2, available: 0, held_by: [] });
    expect(cx.reserved_bins.map((b) => [b.code, b.kind, b.on_hand])).toEqual([
      ["NCR-RCV", "receiving", 1],
      ["NCR-A01-01", "normal", 1],
    ]);

    const [cy] = await context(ncrStore, oilLine(y));
    expect(cy).toMatchObject({ remaining_need: 1, qty_reserved: 0, available: 0, reserved_bins: [] });
    expect(cy.held_by).toEqual([{ card_code: x.code, reg_no: "DL3SAE0001", qty: 2 }]);

    // After issuing 1, the remaining need counts net issued only.
    expectOk(await issueAs(ncrStore, oilLine(x), ncr.normal, 1));
    expect((await context(ncrStore, oilLine(x)))[0]).toMatchObject({ remaining_need: 2, qty_reserved: 1 });

    // Another workshop's line: no row.
    expect(await context(jprStore, oilLine(x))).toEqual([]);
  });

  it("matches record_emergency_buy's reference price: override supplier, preferred supplier, last GRN, standard", async () => {
    const x = await oilCard("DL3SAE0003", 1);
    for (const part of [P.air, P.pad]) {
      expectOk(await rpc(ncrManager, "add_job_card_line", { p_card_id: x.card_id, p_part_id: part, p_qty: 1 }));
    }
    const lines = (
      await db.query<{ part_id: string; id: string }>(`select part_id, id from public.job_card_lines where job_card_id = $1`, [x.card_id])
    ).rows;
    const lineFor = (part: string) => lines.find((l) => l.part_id === part)!.id;
    const refOf = async (part: string) => Number((await context(ncrStore, lineFor(part)))[0].reference_price_paise);

    // Preferred supplier's price.
    expect(await refOf(P.oil)).toBe(32000);
    expect(await refOf(P.oil)).toBe(await referenceOf(P.oil));

    // reorder_settings' supplier overrides the part's preferred supplier.
    await db.query(`insert into public.supplier_parts (supplier_id, part_id, price_paise) values ($1, $2, 30000)`, [SUP.jpr, P.oil]);
    await insertReorder(db, P.oil, NCR, true, 0, 5, SUP.jpr);
    expect(await refOf(P.oil)).toBe(30000);
    expect(await refOf(P.oil)).toBe(await referenceOf(P.oil));

    // No supplier price: the last GRN price, not the standard price.
    const po = await sendPo(ncrManager, [{ part: P.air, qty: 1, price: 21000 }]);
    expectOk(
      await rpc(ncrStore, "receive_grn", {
        p_po_id: po.po_id,
        p_supplier_invoice_no: "INV-CTX",
        p_invoice_date: istToday(),
        p_allow_duplicate_invoice: false,
        p_lines: [{ po_line_id: po.lines[0].line_id, qty_received: 1, qty_damaged: 0, qty_wrong_part: 0, unit_price_paise: 21000 }],
      }),
    );
    expect(await refOf(P.air)).toBe(21000);
    expect(await refOf(P.air)).toBe(await referenceOf(P.air));

    // No supplier and no GRN: the standard price.
    expect(await refOf(P.pad)).toBe(await referenceOf(P.pad));
  });
});
