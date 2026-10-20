// private.check_invariants() / check_invariants_for() detect each SPEC §4 violation. Each case
// corrupts the fixture as postgres inside a transaction that is rolled back.
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pgClient } from "./clients";
import { WORKSHOP_IDS } from "./demo-users";
import { CAT, insertCatalog, insertWorkshopChain, testClear, wsIds } from "./fixtures";
import { checkInvariants, expectInvariantsHold } from "./invariants";

const ncr = wsIds("NCR");

let db: pg.Client;

beforeAll(async () => {
  db = await pgClient();
  await testClear(db);
  await insertCatalog(db);
  await insertWorkshopChain(db, "NCR");
  await insertWorkshopChain(db, "JPR");
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

const violated = async () => [...new Set((await checkInvariants(db)).map((r) => r.invariant))].sort();

describe("check_invariants", () => {
  beforeEach(async () => {
    await db.query("begin");
  });
  afterEach(async () => {
    await db.query("rollback");
  });

  it("returns no rows for a consistent fixture", async () => {
    expect(await checkInvariants(db)).toEqual([]);
  });

  it.each<[string, string[], string[]]>([
    ["1_balance_matches_moves", [`update public.stock_balances set on_hand = on_hand + 1 where bin_id = '${ncr.normal}'`], []],
    [
      "3_reserved_within_usable",
      [`update public.job_card_lines set qty_required = 10, qty_reserved = 10 where id = '${ncr.line}'`],
      [],
    ],
    [
      "4_no_free_stock_while_short",
      [`update public.job_card_lines set qty_reserved = 1 where id = '${ncr.line}'`],
      ["9_parts_complete_at"],
    ],
    [
      "5_reservation_on_unconfirmed_card",
      [
        "alter table public.job_cards disable trigger job_cards_status_check",
        `update public.job_cards set status = 'closed', closed_at = now() where id = '${ncr.card}'`,
      ],
      [],
    ],
    [
      "6_line_matches_moves",
      [`update public.job_card_lines set qty_reserved = 1, qty_issued = 1 where id = '${ncr.line}'`],
      [],
    ],
    ["7_po_line_matches_grns", [`update public.po_lines set qty_accepted = 4 where id = '${ncr.poLine}'`], []],
    [
      "8_emergency_in_matches_buy",
      [`update public.emergency_buys set qty = 2, qty_to_stock = 2 where id = '${ncr.buy}'`],
      [],
    ],
    ["9_parts_complete_at", [`update public.job_cards set parts_complete_at = null where id = '${ncr.card}'`], []],
  ])("detects %s", async (invariant, statements, alsoExpected) => {
    for (const sql of statements) await db.query(sql);
    expect(await violated()).toEqual([invariant, ...alsoExpected].sort());
  });

  it("detects a card that needs review but is marked complete", async () => {
    await db.query(`update public.job_cards set needs_review_reason = 'wrong_fitment: X' where id = $1`, [ncr.card]);
    expect(await violated()).toEqual(["9_parts_complete_at"]);
  });
});

describe("check_invariants_for", () => {
  beforeEach(async () => {
    await db.query("begin");
    await db.query(`update public.stock_balances set on_hand = on_hand + 1 where bin_id = $1`, [ncr.normal]);
  });
  afterEach(async () => {
    await db.query("rollback");
  });

  const forParts = async (ws: string, parts: string[]) =>
    (await db.query("select * from private.check_invariants_for($1, $2)", [ws, parts])).rows;

  it("reports violations for the given workshop and parts", async () => {
    const rows = await forParts(WORKSHOP_IDS.NCR, [CAT.part]);
    expect(rows.map((r) => r.invariant)).toEqual(["1_balance_matches_moves"]);
    expect(rows[0].details).toMatchObject({ bin_id: ncr.normal, on_hand: 4, moves_net: 3 });
  });

  it("ignores other workshops and parts", async () => {
    expect(await forParts(WORKSHOP_IDS.JPR, [CAT.part])).toEqual([]);
    expect(await forParts(WORKSHOP_IDS.NCR, ["10000000-0000-0000-0000-0000000000ff"])).toEqual([]);
  });
});
