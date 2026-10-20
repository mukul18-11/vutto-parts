// v_stock_position (SPEC §4) and v_part_last_price (SPEC §7.4) against hand-computed numbers.
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { clientAs, pgClient, type Client } from "./clients";
import { DEMO_USERS, WORKSHOP_IDS } from "./demo-users";
import { CAT, insertBins, insertCatalog, testClear, wsIds } from "./fixtures";
import { expectInvariantsHold } from "./invariants";

const NCR = WORKSHOP_IDS.NCR;
const JPR = WORKSHOP_IDS.JPR;
const PART2 = "10000000-0000-0000-0000-000000000007";
const manager = DEMO_USERS.find((u) => u.key === "ncr_manager")!.id;
const store = DEMO_USERS.find((u) => u.key === "ncr_store")!.id;
const n = (i: number) => `b1000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
const ID = {
  bin2: n(1),
  bike1: n(2), bike2: n(3), bike3: n(4),
  card1: n(5), card2: n(6), card3: n(7),
  line1: n(8), line2: n(9), line2Cancelled: n(10), line3: n(11),
  po1: n(12), po1Line: n(13), po2: n(14), po2Line: n(15),
  grnOld: n(16), grnOldLine: n(17), grnMid: n(18), grnMidLine: n(19), grnNew: n(20), grnNewLine: n(21),
};

let db: pg.Client;
let ncrManager: Client;
let jprStore: Client;
let admin: Client;

/*
 * NCR, part P (hand-computed):
 *   bins:   A01-01 adjust_in 5, issue 1 -> 4; A01-02 adjust_in 3; RCV grn 1 + 2 -> 3; QRN adjust_in 2
 *           usable_on_hand = 4 + 3 + 3 = 10, quarantine_on_hand = 2
 *   lines:  card1 (confirmed) required 4, issued 1, reserved 3 -> uncovered 0
 *           card2 (confirmed) required 9, reserved 7 -> uncovered 2; plus a cancelled line (ignored)
 *           card3 (draft) required 3 (not demand)
 *           reserved = 10, available = 0, outstanding_demand = 3 + 9 = 12, shortfall = 2
 *   POs:    PO1 sent, ordered 10 -> open 10
 *           PO2 partially_received, ordered 6, accepted 3, rejected 1, cancelled 1 -> open 2
 *           on_order = 12
 * JPR, part P: JPR-A01-01 adjust_in 7 -> usable 7, available 7. Part 2: zeros everywhere.
 */
const NCR_P = {
  workshop_id: NCR, part_id: CAT.part, usable_on_hand: 10, quarantine_on_hand: 2, reserved: 10,
  available: 0, on_order: 12, outstanding_demand: 12, shortfall: 2,
};
const zeros = (workshop_id: string, part_id: string) => ({
  workshop_id, part_id, usable_on_hand: 0, quarantine_on_hand: 0, reserved: 0,
  available: 0, on_order: 0, outstanding_demand: 0, shortfall: 0,
});
const JPR_P = { ...zeros(JPR, CAT.part), usable_on_hand: 7, available: 7 };

async function q(sql: string, params: unknown[] = []) {
  await db.query(sql, params);
}

beforeAll(async () => {
  db = await pgClient();
  await testClear(db);
  await insertCatalog(db);
  await q(
    `insert into public.parts (id, sku, name, category, part_type, uom, standard_price_paise)
     values ($1, 'TEST-PAD', 'Brake pad', 'wear', 'front_brake_pad', 'set', 50000)`,
    [PART2],
  );
  const ncr = wsIds("NCR");
  const jpr = wsIds("JPR");
  await insertBins(db, "NCR");
  await insertBins(db, "JPR");
  await q(`insert into public.bins (id, workshop_id, code, kind) values ($1, $2, 'NCR-A01-02', 'normal')`, [ID.bin2, NCR]);

  const adjustIn = (ws: string, bin: string, qty: number) =>
    q(
      `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, reason, user_id)
       values ($1, $2, 'adjust_in', $3, $4, 'found', $5)`,
      [ws, CAT.part, qty, bin, manager],
    );
  await adjustIn(NCR, ncr.normal, 5);
  await adjustIn(NCR, ID.bin2, 3);
  await adjustIn(NCR, ncr.qrn, 2);
  await adjustIn(JPR, jpr.normal, 7);

  for (const [i, bike] of [ID.bike1, ID.bike2, ID.bike3].entries()) {
    await q(
      `insert into public.bikes (id, workshop_id, reg_no, model_id, variant_id, mfg_year, status, purchased_at, arrived_at)
       values ($1, $2, $3, $4, $5, 2022, 'at_workshop', now() - interval '3 days', now() - interval '2 days')`,
      [bike, NCR, `DL1AB000${i + 1}`, CAT.model, CAT.variant],
    );
  }
  for (const [i, [card, bike]] of [[ID.card1, ID.bike1], [ID.card2, ID.bike2], [ID.card3, ID.bike3]].entries()) {
    await q(`insert into public.job_cards (id, workshop_id, code, bike_id) values ($1, $2, $3, $4)`, [
      card, NCR, `JC-NCR-00000${i + 1}`, bike,
    ]);
  }
  const line = (id: string, card: string, required: number, cancelled = false) =>
    q(
      `insert into public.job_card_lines (id, workshop_id, job_card_id, part_id, qty_required, source, cancelled_at)
       values ($1, $2, $3, $4, $5, 'suggested', case when $6 then now() end)`,
      [id, NCR, card, CAT.part, required, cancelled],
    );
  await line(ID.line1, ID.card1, 4);
  await line(ID.line2, ID.card2, 9);
  await line(ID.line2Cancelled, ID.card2, 5, true);
  await line(ID.line3, ID.card3, 3);
  await q(
    `update public.job_cards set status = 'confirmed', confirmed_at = now(), confirmed_by = $2 where id = any ($1)`,
    [[ID.card1, ID.card2], manager],
  );

  await q(
    `insert into public.stock_moves (workshop_id, part_id, move_type, qty, from_bin_id, job_card_line_id, user_id)
     values ($1, $2, 'issue', 1, $3, $4, $5)`,
    [NCR, CAT.part, ncr.normal, ID.line1, store],
  );
  await q(`update public.job_card_lines set qty_issued = 1 where id = $1`, [ID.line1]);

  await q(
    `insert into public.purchase_orders (id, workshop_id, code, supplier_id, status, sent_at, expected_on) values
       ($1, $3, 'PO-NCR-000001', $4, 'sent', now(), current_date + 2),
       ($2, $3, 'PO-NCR-000002', $4, 'partially_received', now() - interval '6 days', current_date)`,
    [ID.po1, ID.po2, NCR, CAT.supplier],
  );
  await q(
    `insert into public.po_lines
       (id, workshop_id, po_id, part_id, qty_ordered, qty_accepted, qty_rejected, qty_cancelled, unit_price_paise, source)
     values ($1, $3, $4, $6, 10, 0, 0, 0, 31000, 'suggested'),
            ($2, $3, $5, $6, 6, 3, 1, 1, 31000, 'manual')`,
    [ID.po1Line, ID.po2Line, NCR, ID.po1, ID.po2, CAT.part],
  );
  // Three GRNs on PO2: oldest accepted 1 at 250.00, middle accepted 2 at 300.00 (the last
  // purchase price), newest all damaged at 999.99 (no accepted units, so it never sets the price).
  const grns: [string, string, string, number, number, number, number][] = [
    [ID.grnOld, ID.grnOldLine, "5 days", 1, 1, 0, 25000],
    [ID.grnMid, ID.grnMidLine, "2 days", 2, 2, 0, 30000],
    [ID.grnNew, ID.grnNewLine, "1 day", 1, 0, 1, 99999],
  ];
  for (const [i, [grn, grnLine, ago, received, accepted, damaged, price]] of grns.entries()) {
    await q(
      `insert into public.grns (id, workshop_id, code, po_id, supplier_id, supplier_invoice_no, invoice_date, received_by, received_at)
       values ($1, $2, $3, $4, $5, $6, current_date, $7, now() - $8::interval)`,
      [grn, NCR, `GRN-NCR-00000${i + 1}`, ID.po2, CAT.supplier, `INV-${i + 1}`, store, ago],
    );
    await q(
      `insert into public.grn_lines
         (id, workshop_id, grn_id, po_line_id, part_id, qty_received, qty_accepted, qty_damaged, unit_price_paise)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [grnLine, NCR, grn, ID.po2Line, CAT.part, received, accepted, damaged, price],
    );
    if (accepted > 0) {
      await q(
        `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, grn_line_id, user_id)
         values ($1, $2, 'grn', $3, $4, $5, $6)`,
        [NCR, CAT.part, accepted, ncr.rcv, grnLine, store],
      );
    }
  }

  await q(`update public.job_card_lines set qty_reserved = 3 where id = $1`, [ID.line1]);
  await q(`update public.job_card_lines set qty_reserved = 7 where id = $1`, [ID.line2]);
  await q(`update public.job_cards set parts_complete_at = now() where id = $1`, [ID.card1]);

  ncrManager = await clientAs("ncr_manager");
  jprStore = await clientAs("jpr_store");
  admin = await clientAs("admin");
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

type Key = { workshop_id: string | null; part_id: string | null };
const byKey = (a: Key, b: Key) => `${a.workshop_id}${a.part_id}`.localeCompare(`${b.workshop_id}${b.part_id}`);

describe("v_stock_position", () => {
  it("gives the hand-computed numbers for a part with 2 bins, 2 live lines and 2 open PO lines", async () => {
    const { data, error } = await ncrManager.from("v_stock_position").select("*").order("part_id");
    expect(error).toBeNull();
    expect(data).toEqual([NCR_P, zeros(NCR, PART2)].sort(byKey));
  });

  it("gives a Jaipur user only Jaipur rows", async () => {
    const { data, error } = await jprStore.from("v_stock_position").select("*");
    expect(error).toBeNull();
    expect(data!.filter((r) => r.workshop_id === NCR)).toEqual([]);
    expect([...data!].sort(byKey)).toEqual([JPR_P, zeros(JPR, PART2)].sort(byKey));
  });

  it("gives admin every (workshop, part), matching private.stock_position", async () => {
    const { data, error } = await admin.from("v_stock_position").select("*");
    expect(error).toBeNull();
    const expected = [NCR_P, zeros(NCR, PART2), JPR_P, zeros(JPR, PART2)].sort(byKey);
    expect([...data!].sort(byKey)).toEqual(expected);
    const { rows } = await db.query("select * from private.stock_position()");
    expect(rows.sort(byKey)).toEqual(expected);
  });

  it("private.stock_position filters by workshop and parts", async () => {
    const { rows } = await db.query("select * from private.stock_position($1, $2)", [NCR, [CAT.part]]);
    expect(rows).toEqual([NCR_P]);
  });
});

describe("v_part_last_price", () => {
  it("is the latest GRN line price with accepted units", async () => {
    const { data, error } = await ncrManager.from("v_part_last_price").select("part_id, unit_price_paise, grn_id");
    expect(error).toBeNull();
    expect(data).toEqual([{ part_id: CAT.part, unit_price_paise: 30000, grn_id: ID.grnMid }]);
  });

  it("shows a Jaipur user no NCR prices", async () => {
    const { data } = await jprStore.from("v_part_last_price").select("*");
    expect(data).toEqual([]);
  });
});
