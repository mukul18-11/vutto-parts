// Emergency buys (SPEC §8.3), acting as the demo users: how much is issued, which reservations
// are released, the reference price chain and the premium in v_emergency_buys.
// Not covered here (dropped by the user): bill photos (bucket, attach_emergency_bill, prompt
// test 7) and the concurrent buys on two lines of one card (prompt test 9).
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { istToday } from "../../src/lib/time";
import { clientAs, pgClient, type Client } from "./clients";
import { insertBins, testClear } from "./fixtures";
import { expectInvariantsHold } from "./invariants";
import {
  arriveAs,
  confirmAs,
  createBikeAs,
  expectCode,
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
  type IssueLine,
} from "./job-card-fixtures";
import { insertPurchasingCatalog, insertReorder, sendPo, SUP } from "./purchasing-fixtures";

let db: pg.Client;
let ncrManager: Client;
let ncrStore: Client;
let jprStore: Client;

type BuyResult = {
  buy_id: string;
  qty: number;
  issued: number;
  qty_to_stock: number;
  warning: string | null;
  reference_price_paise: number;
  premium: number | null;
  line: IssueLine;
  receiving_on_hand: number;
  allocated: { line_id: string; card_code: string; qty: number }[];
};

const stockIn = (qty: number, part: string = P.oil, bin: string = ncr.normal) => stockInAs(db, qty, part, bin);
const one = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => queryOne<T>(db, sql, params);
const arrive = (c: Card) => arriveAs(ncrStore, c);

async function oilCard(reg: string, qty = 1): Promise<Card> {
  const card = await createBikeAs(ncrManager, reg, M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil, qty }]);
  return confirmAs(ncrManager, card.card_id);
}
const oilLine = (c: Card) => lineOf(c, "T-OIL").line_id;

const buy = (line: string, qty: number, price = 40000, extra: Record<string, unknown> = {}) =>
  rpc(ncrStore, "record_emergency_buy", {
    p_line_id: line,
    p_qty: qty,
    p_unit_price_paise: price,
    p_vendor_name: "Sharma Auto, Karol Bagh",
    p_reason: "no_stock",
    ...extra,
  });
const buyOk = async (line: string, qty: number, price = 40000) => expectOk<BuyResult>(await buy(line, qty, price));

async function line(lineId: string) {
  return one<{ qty_required: number; qty_reserved: number; qty_issued: number; status: string }>(
    `select qty_required, qty_reserved, qty_issued, status from public.job_card_lines where id = $1`,
    [lineId],
  );
}

async function completeAt(cardId: string): Promise<string | null> {
  return (
    await one<{ t: string | null }>(`select parts_complete_at::text as t from public.job_cards where id = $1`, [cardId])
  ).t;
}

beforeAll(async () => {
  db = await pgClient();
  ncrManager = await clientAs("ncr_manager");
  ncrStore = await clientAs("ncr_store");
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

describe("record_emergency_buy: issue and reservations (test 6)", () => {
  it("needs 2, 1 reserved, 0 free: buy 1 issues 1 and keeps the reservation", async () => {
    await stockIn(1);
    const x = await oilCard("DL3SAK0001", 2);
    await arrive(x);
    expect(await completeAt(x.card_id)).toBeNull();

    const res = await buyOk(oilLine(x), 1);
    expect(res).toMatchObject({ qty: 1, issued: 1, qty_to_stock: 0, warning: null, receiving_on_hand: 0 });
    expect(res.line).toMatchObject({ qty_required: 2, qty_reserved: 1, qty_issued: 1, status: "reserved" });
    expect(await completeAt(x.card_id)).not.toBeNull();

    const moves = (
      await db.query(
        `select move_type, qty, from_bin_id, to_bin_id, job_card_line_id, emergency_buy_id
         from public.stock_moves where emergency_buy_id = $1 order by id`,
        [res.buy_id],
      )
    ).rows;
    expect(moves).toEqual([
      { move_type: "emergency_in", qty: 1, from_bin_id: null, to_bin_id: ncr.rcv, job_card_line_id: null, emergency_buy_id: res.buy_id },
      { move_type: "issue", qty: 1, from_bin_id: ncr.rcv, to_bin_id: null, job_card_line_id: oilLine(x), emergency_buy_id: res.buy_id },
    ]);
  });

  it("needs 2 with 2 reserved: buy 1 issues 1, keeps 1 and releases 1 to the next bike", async () => {
    await stockIn(2);
    const x = await oilCard("DL3SAK0002", 2);
    const y = await oilCard("DL3SAK0003", 1);
    await arrive(x);

    const res = await buyOk(oilLine(x), 1);
    expect(res.line).toMatchObject({ qty_required: 2, qty_reserved: 1, qty_issued: 1 });
    expect(res.allocated).toEqual([expect.objectContaining({ line_id: oilLine(y), qty: 1 })]);
    expect(await line(oilLine(y))).toMatchObject({ qty_reserved: 1, status: "reserved" });
  });

  it("a line a GRN fully reserved meanwhile: the bought unit is issued, the reservation released", async () => {
    const x = await oilCard("DL3SAK0004", 1);
    const y = await oilCard("DL3SAK0005", 1);
    await arrive(x);
    const po = await sendPo(ncrManager, [{ part: P.oil, qty: 1 }]);
    expectOk(
      await rpc(ncrStore, "receive_grn", {
        p_po_id: po.po_id,
        p_supplier_invoice_no: "INV-1",
        p_invoice_date: istToday(),
        p_allow_duplicate_invoice: false,
        p_lines: [{ po_line_id: po.lines[0].line_id, qty_received: 1, qty_damaged: 0, qty_wrong_part: 0, unit_price_paise: 32000 }],
      }),
    );
    expect(await line(oilLine(x))).toMatchObject({ qty_required: 1, qty_reserved: 1 });

    const res = await buyOk(oilLine(x), 1);
    expect(res).toMatchObject({ issued: 1, qty_to_stock: 0 });
    expect(res.line).toMatchObject({ qty_reserved: 0, qty_issued: 1, status: "issued" });
    expect(await line(oilLine(y))).toMatchObject({ qty_reserved: 1 });
  });

  it("a line already fully issued: everything goes to stock", async () => {
    await stockIn(1);
    const x = await oilCard("DL3SAK0006", 1);
    await arrive(x);
    expectOk(await issueAs(ncrStore, oilLine(x), ncr.normal, 1));

    const res = await buyOk(oilLine(x), 1);
    expect(res).toMatchObject({ issued: 0, qty_to_stock: 1, warning: null, receiving_on_hand: 1 });
    expect(res.line).toMatchObject({ qty_issued: 1, qty_reserved: 0 });
    const row = await one(`select qty_issued, qty_to_stock from public.emergency_buys where id = $1`, [res.buy_id]);
    expect(row).toEqual({ qty_issued: 0, qty_to_stock: 1 });
  });

  it("a line the manager cancelled: recorded with LINE_CANCELLED, the unit goes to the next bike", async () => {
    const x = await oilCard("DL3SAK0007", 1);
    const y = await oilCard("DL3SAK0008", 1);
    await arrive(x);
    expectOk(await rpc(ncrManager, "set_line_qty", { p_line_id: oilLine(x), p_qty: 0, p_reason: "Not needed" }));

    const res = await buyOk(oilLine(x), 1);
    expect(res).toMatchObject({ issued: 0, qty_to_stock: 1, warning: "LINE_CANCELLED" });
    expect(res.allocated).toEqual([expect.objectContaining({ line_id: oilLine(y), qty: 1 })]);
    expect(await line(oilLine(y))).toMatchObject({ qty_reserved: 1 });
    const n = await one<{ n: number }>(`select count(*)::int as n from public.emergency_buys where id = $1`, [res.buy_id]);
    expect(n.n).toBe(1);
  });

  it("records a buy for a bike not arrived or a draft card as stock, with a warning", async () => {
    const x = await oilCard("DL3SAK0009", 1);
    const notArrived = await buyOk(oilLine(x), 1);
    expect(notArrived).toMatchObject({ issued: 0, qty_to_stock: 1, warning: "BIKE_NOT_ARRIVED" });
    // The unit is free stock now, so it was reserved to this very line.
    expect(await line(oilLine(x))).toMatchObject({ qty_reserved: 1, qty_issued: 0 });

    const draft = await createBikeAs(ncrManager, "DL3SAK0010", M.splendor, V.splendorDrum, [
      { finding_type_id: FT.oil, qty: 1 },
    ]);
    const res = await buyOk(oilLine(draft), 2);
    expect(res).toMatchObject({ issued: 0, qty_to_stock: 2, warning: "JOB_CARD_NOT_CONFIRMED", receiving_on_hand: 3 });
  });
});

describe("record_emergency_buy: prices and validation", () => {
  it("snapshots the reference price: override supplier, preferred supplier, last GRN, standard", async () => {
    const x = await oilCard("DL3SAL0001", 1);
    for (const part of [P.air, P.pad]) {
      expectOk(await rpc(ncrManager, "add_job_card_line", { p_card_id: x.card_id, p_part_id: part, p_qty: 1 }));
    }
    await arrive(x);
    const lines = (
      await db.query<{ sku: string; id: string }>(
        `select p.sku, l.id from public.job_card_lines l join public.parts p on p.id = l.part_id where l.job_card_id = $1`,
        [x.card_id],
      )
    ).rows;
    const lineFor = (sku: string) => lines.find((l) => l.sku === sku)!.id;

    // Preferred supplier's price (32000).
    const oil = await buyOk(lineFor("T-OIL"), 1, 40000);
    expect(oil).toMatchObject({ reference_price_paise: 32000, premium: 0.25 });

    // reorder_settings' supplier overrides the part's preferred supplier.
    await db.query(`insert into public.supplier_parts (supplier_id, part_id, price_paise) values ($1, $2, 30000)`, [
      SUP.jpr,
      P.oil,
    ]);
    await insertReorder(db, P.oil, NCR, true, 0, 5, SUP.jpr);
    expect((await buyOk(lineFor("T-OIL"), 1, 30000)).reference_price_paise).toBe(30000);

    // No supplier price: last GRN price (21000), not the standard price (18000).
    const po = await sendPo(ncrManager, [{ part: P.air, qty: 1, price: 21000 }]);
    expectOk(
      await rpc(ncrStore, "receive_grn", {
        p_po_id: po.po_id,
        p_supplier_invoice_no: "INV-AIR",
        p_invoice_date: istToday(),
        p_allow_duplicate_invoice: false,
        p_lines: [{ po_line_id: po.lines[0].line_id, qty_received: 1, qty_damaged: 0, qty_wrong_part: 0, unit_price_paise: 21000 }],
      }),
    );
    const lastBefore = await one(`select unit_price_paise::int as p, grn_id from public.v_part_last_price where part_id = $1`, [P.air]);
    expect((await buyOk(lineFor("T-AIR"), 1, 99000)).reference_price_paise).toBe(21000);
    // An emergency price never changes the last purchase price.
    expect(await one(`select unit_price_paise::int as p, grn_id from public.v_part_last_price where part_id = $1`, [P.air])).toEqual(
      lastBefore,
    );

    // No supplier and no GRN: standard price.
    const pad = await buyOk(lineFor("T-PAD"), 1, 45000);
    expect(pad).toMatchObject({ reference_price_paise: 45000, premium: 0 });
  });

  it("shows the premium in v_emergency_buys, null without a reference", async () => {
    const x = await oilCard("DL3SAL0002", 1);
    await arrive(x);
    const res = await buyOk(oilLine(x), 1, 40000);

    // A buy with no reference price, inserted as postgres (as seeded history may be).
    await db.query(
      `insert into public.emergency_buys
         (id, workshop_id, job_card_line_id, part_id, vendor_name, qty, unit_price_paise, reference_price_paise,
          qty_issued, qty_to_stock, reason, bought_by)
       values ('d2000000-0000-0000-0000-000000000001', $1, $2, $3, 'Old shop', 1, 50000, null, 0, 1, 'other', $4)`,
      [NCR, oilLine(x), P.oil, "00000000-0000-0000-0000-0000000000b2"],
    );
    await db.query(
      `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, emergency_buy_id)
       values ($1, $2, 'emergency_in', 1, $3, 'd2000000-0000-0000-0000-000000000001')`,
      [NCR, P.oil, ncr.rcv],
    );

    const { data, error } = await ncrStore.from("v_emergency_buys").select("id, premium").order("unit_price_paise");
    expect(error).toBeNull();
    expect(data).toEqual([
      { id: res.buy_id, premium: 0.25 },
      { id: "d2000000-0000-0000-0000-000000000001", premium: null },
    ]);
    expect((await jprStore.from("v_emergency_buys").select("id")).data).toEqual([]);
  });

  it("validates input and refuses other workshops and anything below store keeper", async () => {
    const x = await oilCard("DL3SAL0003", 1);
    await arrive(x);
    expectCode(await buy(oilLine(x), 1, 0), "VALIDATION");
    expectCode(await buy(oilLine(x), 1, 10000001), "VALIDATION");
    expectCode(await buy(oilLine(x), 51), "VALIDATION");
    expectCode(await buy(oilLine(x), 0), "VALIDATION");
    expectCode(await buy(oilLine(x), 1, 40000, { p_reason: "cheaper" }), "VALIDATION");
    expectCode(await buy(oilLine(x), 1, 40000, { p_vendor_name: "  " }), "VALIDATION");
    expectCode(
      await rpc(jprStore, "record_emergency_buy", {
        p_line_id: oilLine(x),
        p_qty: 1,
        p_unit_price_paise: 40000,
        p_vendor_name: "Shop",
        p_reason: "no_stock",
      }),
      "NOT_FOUND",
    );
    // The upper price bound is allowed.
    expect((await buyOk(oilLine(x), 1, 10000000)).issued).toBe(1);
  });
});
