// Issue to job card, returns, the fit badge and log_app_error (SPEC §8.1, §8.2, §9.2, §9.3,
// §11.1), acting as the demo users. Cards are made with create_bike + confirm_job_card.
// No concurrency tests: the user dropped them for this prompt (prompt test 2 and SPEC §17's
// "last unit issued by two store keepers" are not covered here).
import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anonClient, clientAs, pgClient, type Client } from "./clients";
import { insertBins, testClear } from "./fixtures";
import { expectInvariantsHold } from "./invariants";
import {
  arriveAs,
  BIN2,
  confirmAs,
  createBikeAs,
  detail,
  expectCode,
  expectOk,
  FT,
  insertJobCardCatalog,
  issueAs,
  jpr,
  lineOf,
  M,
  ncr,
  P,
  queryOne,
  rpc,
  stockIn as stockInAs,
  toRepairAs,
  V,
  type Card,
  type Finding,
  type IssueLine,
} from "./job-card-fixtures";

let db: pg.Client;
let ncrManager: Client;
let ncrStore: Client;
let jprManager: Client;
let jprStore: Client;
let admin: Client;

type IssueResult = { line: IssueLine; bin_on_hand: number; move_id: number; allocated: { line_id: string }[] };
type ReturnResult = Card & {
  line: IssueLine;
  bin_id: string;
  bin_on_hand: number;
  flagged_fitment: boolean;
  allocated: { line_id: string; card_code: string; qty: number }[];
};
type Badge = { badge: string; confirmed_count: number; flagged_count: number; last_flag_note: string | null };

const createBike = (reg: string, findings: Finding[], c?: Client, model = M.splendor, variant: string | null = V.splendorDrum) =>
  createBikeAs(c ?? ncrManager, reg, model, variant, findings);
const confirm = (card: string, c?: Client) => confirmAs(c ?? ncrManager, card);
const stockIn = (qty: number, part: string = P.oil, bin: string = ncr.normal) => stockInAs(db, qty, part, bin);
const one = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => queryOne<T>(db, sql, params);
const arrive = (c: Card) => arriveAs(ncrStore, c);
const toRepair = (c: Card) => toRepairAs(ncrStore, ncrManager, c);
const issue = (line: string, qty: number, bin: string = ncr.normal, requestId?: string) =>
  issueAs(ncrStore, line, bin, qty, requestId);
const issueOk = async (line: string, qty: number, bin: string = ncr.normal) =>
  expectOk<IssueResult>(await issue(line, qty, bin));
const returnPart = (line: string, qty: number, reason: string, extra: { p_to_bin_id?: string; p_note?: string } = {}) =>
  rpc(ncrStore, "return_from_job_card", {
    p_line_id: line,
    p_qty: qty,
    p_reason: reason,
    ...(reason === "damaged" ? {} : { p_to_bin_id: ncr.normal }),
    ...extra,
  });
const closeCard = (card: string, drop = false, reason?: string) =>
  rpc(ncrManager, "close_job_card", {
    p_card_id: card,
    p_drop_remaining: drop,
    ...(reason ? { p_reason: reason } : {}),
  });

/** A confirmed card for an engine oil finding (T-OIL, universal) of the given qty. */
async function oilCard(reg: string, qty = 2): Promise<Card> {
  return confirm((await createBike(reg, [{ finding_type_id: FT.oil, qty }])).card_id);
}

/** A confirmed card for a front brake finding on a Splendor drum (T-SHOE, catalogue fitment). */
async function shoeCard(reg: string, qty = 1): Promise<Card> {
  return confirm((await createBike(reg, [{ finding_type_id: FT.brake, qty }])).card_id);
}

const oilLine = (c: Card) => lineOf(c, "T-OIL").line_id;
const shoeLine = (c: Card) => lineOf(c, "T-SHOE").line_id;

async function line(lineId: string) {
  return one<{
    qty_required: number;
    qty_reserved: number;
    qty_issued: number;
    qty_returned: number;
    status: string;
    cancelled_at: string | null;
  }>(
    `select qty_required, qty_reserved, qty_issued, qty_returned, status, cancelled_at::text
     from public.job_card_lines where id = $1`,
    [lineId],
  );
}

async function card(cardId: string) {
  return one<{ status: string; parts_complete_at: string | null; needs_review_reason: string | null }>(
    `select status, parts_complete_at::text, needs_review_reason from public.job_cards where id = $1`,
    [cardId],
  );
}

async function onHand(bin: string, part: string = P.oil): Promise<number> {
  const r = await one<{ on_hand: number } | undefined>(
    `select on_hand from public.stock_balances where bin_id = $1 and part_id = $2`,
    [bin, part],
  );
  return r?.on_hand ?? 0;
}

async function fitment(part: string, variant: string) {
  return one<
    | { source: string; confirmed_count: number; flagged_count: number; last_flag_note: string | null }
    | undefined
  >(
    `select source, confirmed_count, flagged_count, last_flag_note from public.part_fitments
     where part_id = $1 and variant_id = $2`,
    [part, variant],
  );
}

async function fitments() {
  return (
    await db.query(
      `select part_id, variant_id, source, confirmed_count, flagged_count from public.part_fitments
       order by part_id, variant_id`,
    )
  ).rows;
}

async function badge(lineId: string, c: Client = ncrStore): Promise<Badge[]> {
  const { data, error } = await c.rpc("fit_badge", { p_line_id: lineId });
  expect(error).toBeNull();
  return data as Badge[];
}

beforeAll(async () => {
  db = await pgClient();
  ncrManager = await clientAs("ncr_manager");
  ncrStore = await clientAs("ncr_store");
  jprManager = await clientAs("jpr_manager");
  jprStore = await clientAs("jpr_store");
  admin = await clientAs("admin");
});

beforeEach(async () => {
  await testClear(db);
  await insertBins(db, "NCR");
  await insertBins(db, "JPR");
  await insertJobCardCatalog(db);
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

describe("issue_to_job_card (SPEC §8.1)", () => {
  it("test 1: never issues the last unit reserved for another bike", async () => {
    await stockIn(1);
    const a = await oilCard("DL3SAD0001", 1);
    const b = await oilCard("DL3SAD0002", 1);
    await arrive(a);
    await arrive(b);

    const res = await issue(oilLine(b), 1);
    expectCode(res, "INSUFFICIENT_RESERVATION");
    expect(detail(res)).toMatchObject({ reserved: 0, available: 0, held_by: [a.code] });

    const ok = await issueOk(oilLine(a), 1);
    expect(ok.line).toMatchObject({ qty_reserved: 0, qty_issued: 1, status: "issued", card_code: a.code });
    expect(ok.bin_on_hand).toBe(0);
    expect(await onHand(ncr.normal)).toBe(0);
    const moves = await one<{ n: number }>(
      `select count(*)::int as n from public.stock_moves where move_type = 'issue' and job_card_line_id = $1`,
      [oilLine(a)],
    );
    expect(moves.n).toBe(1);
  });

  it("test 3: refuses more than the line's reservation when the extra unit is another bike's", async () => {
    await stockIn(2);
    const b = await oilCard("DL3SAD0003", 1);
    const a = await oilCard("DL3SAD0004", 2);
    expect(lineOf(a, "T-OIL").qty_reserved).toBe(1);
    await arrive(a);

    const res = await issue(oilLine(a), 2);
    expectCode(res, "INSUFFICIENT_RESERVATION");
    expect(detail(res)).toMatchObject({ reserved: 1, qty: 2, available: 0, held_by: [b.code] });
    expect(await line(oilLine(b))).toMatchObject({ qty_reserved: 1, qty_issued: 0 });

    await issueOk(oilLine(a), 1);
  });

  it("allocates free stock to the line before checking the reservation", async () => {
    const a = await oilCard("DL3SAD0005", 1);
    await arrive(a);
    await stockIn(1); // as postgres: no allocation ran
    const ok = await issueOk(oilLine(a), 1);
    expect(ok.line).toMatchObject({ qty_issued: 1, qty_reserved: 0 });
  });

  it("test 4: bin stock and kind, card, bike and line state, workshop", async () => {
    await stockIn(1, P.oil, ncr.normal);
    await stockIn(1, P.oil, BIN2);
    await stockIn(1, P.oil, ncr.rcv);
    const a = await oilCard("DL3SAD0006", 3);
    expect(lineOf(a, "T-OIL").qty_reserved).toBe(3);

    // Bike still purchased.
    expectCode(await issue(oilLine(a), 1), "BIKE_NOT_ARRIVED");
    await arrive(a);

    const short = await issue(oilLine(a), 2);
    expectCode(short, "INSUFFICIENT_BIN_STOCK");
    expect(detail(short)).toMatchObject({ on_hand: 1, qty: 2 });
    expect(detail(short).bins).toEqual([
      expect.objectContaining({ bin_id: BIN2, code: "NCR-A01-02", on_hand: 1 }),
      expect.objectContaining({ bin_id: ncr.rcv, code: "NCR-RCV", on_hand: 1 }),
    ]);

    // Receiving is issuable; quarantine is not.
    const fromRcv = await issueOk(oilLine(a), 1, ncr.rcv);
    expect(fromRcv.bin_on_hand).toBe(0);
    expectCode(await issue(oilLine(a), 1, ncr.qrn), "BIN_NOT_ISSUABLE");
    expectCode(await issue(oilLine(a), 0), "VALIDATION");

    // Draft card.
    const draft = await createBike("DL3SAD0007", [{ finding_type_id: FT.oil, qty: 1 }]);
    expectCode(await issue(oilLine(draft), 1), "JOB_CARD_NOT_CONFIRMED");

    // Cancelled line.
    const c = await oilCard("DL3SAD0008", 1);
    await arrive(c);
    expectOk(await rpc(ncrManager, "set_line_qty", { p_line_id: oilLine(c), p_qty: 0, p_reason: "Not needed" }));
    expectCode(await issue(oilLine(c), 1), "LINE_CANCELLED");

    // Another workshop's bin or line looks like a missing one.
    const j = await confirm(
      (await createBike("RJ14AD0001", [{ finding_type_id: FT.oil, qty: 1 }], jprManager)).card_id,
      jprManager,
    );
    expectCode(await issueAs(jprStore, oilLine(j), ncr.normal, 1), "NOT_FOUND");
    expectCode(await issueAs(jprStore, oilLine(j), jpr.normal, 1), "BIKE_NOT_ARRIVED");
    expectCode(await issue(oilLine(j), 1, jpr.normal), "NOT_FOUND");
  });
});

describe("return_from_job_card (SPEC §8.2, test 5)", () => {
  it("not_needed lowers qty_required and frees the unit for the next bike", async () => {
    await stockIn(2);
    const x = await oilCard("DL3SAE0001", 2);
    const y = await oilCard("DL3SAE0002", 1);
    await arrive(x);
    await issueOk(oilLine(x), 2);

    const res = expectOk<ReturnResult>(await returnPart(oilLine(x), 1, "not_needed"));
    expect(res.line).toMatchObject({ qty_required: 1, qty_returned: 1, net_issued: 1, status: "issued" });
    expect(res.allocated).toEqual([expect.objectContaining({ line_id: oilLine(y), qty: 1 })]);
    expect(await line(oilLine(y))).toMatchObject({ qty_reserved: 1 });
    expect((await card(x.card_id)).parts_complete_at).not.toBeNull();
    const move = await one(
      `select move_type, reason, to_bin_id from public.stock_moves where job_card_line_id = $1 order by id desc limit 1`,
      [oilLine(x)],
    );
    expect(move).toEqual({ move_type: "return_to_stock", reason: "not_needed", to_bin_id: ncr.normal });

    // Returning the rest leaves qty_required 0 and nothing issued: the line is cancelled.
    const all = expectOk<ReturnResult>(await returnPart(oilLine(x), 1, "not_needed"));
    expect(all.line).toMatchObject({ qty_required: 0, net_issued: 0, status: "cancelled" });
    expect(all.lines).toHaveLength(0);
  });

  it("issued_by_mistake reopens the need and re-reserves to the same line first", async () => {
    await stockIn(1);
    const x = await oilCard("DL3SAE0003", 1);
    const y = await oilCard("DL3SAE0004", 1);
    // y is ahead of x in FIFO order from now on.
    expectOk(await rpc(ncrManager, "set_needed_by", { p_card_id: x.card_id, p_date: "2099-01-01" }));
    await arrive(x);
    await issueOk(oilLine(x), 1);

    const res = expectOk<ReturnResult>(await returnPart(oilLine(x), 1, "issued_by_mistake"));
    expect(res.line).toMatchObject({ qty_required: 1, qty_reserved: 1, net_issued: 0, status: "reserved" });
    expect(await line(oilLine(y))).toMatchObject({ qty_reserved: 0 });
    expect((await card(x.card_id)).parts_complete_at).not.toBeNull();
  });

  it("damaged goes to quarantine, the need reopens and the card becomes incomplete", async () => {
    await stockIn(1);
    const x = await oilCard("DL3SAE0005", 1);
    await arrive(x);
    await issueOk(oilLine(x), 1);
    expect((await card(x.card_id)).parts_complete_at).not.toBeNull();

    const res = expectOk<ReturnResult>(await returnPart(oilLine(x), 1, "damaged", { p_note: "Seal broken" }));
    expect(res.bin_id).toBe(ncr.qrn);
    expect(res.bin_on_hand).toBe(1);
    expect(res.line).toMatchObject({ qty_required: 1, qty_reserved: 0, net_issued: 0, status: "needed" });
    expect(await onHand(ncr.qrn)).toBe(1);
    expect(await card(x.card_id)).toMatchObject({ parts_complete_at: null });
  });

  it("wrong_fitment flags the fitment, needs review until a manager clears it", async () => {
    await stockIn(1, P.shoe);
    await stockIn(1, P.air);
    const x = await shoeCard("DL3SAE0006");
    await toRepair(x);
    await issueOk(shoeLine(x), 1);

    expectCode(await returnPart(shoeLine(x), 1, "wrong_fitment", { p_note: "bad" }), "VALIDATION");
    expectCode(await returnPart(shoeLine(x), 1, "wrong_fitment"), "VALIDATION");

    const res = expectOk<ReturnResult>(
      await returnPart(shoeLine(x), 1, "wrong_fitment", { p_note: "Shoe too narrow for this drum" }),
    );
    expect(res.flagged_fitment).toBe(true);
    expect(res.line).toMatchObject({ qty_required: 0, qty_reserved: 0, net_issued: 0, status: "cancelled" });
    expect(await fitment(P.shoe, V.splendorDrum)).toEqual({
      source: "catalogue",
      confirmed_count: 0,
      flagged_count: 1,
      last_flag_note: "Shoe too narrow for this drum",
    });
    expect(await card(x.card_id)).toEqual({
      status: "confirmed",
      parts_complete_at: null,
      needs_review_reason: "wrong_fitment: T-SHOE",
    });
    expect(await onHand(ncr.normal, P.shoe)).toBe(1);

    // A store keeper's extra line does not clear it.
    expectOk(
      await rpc(ncrStore, "add_job_card_line", {
        p_card_id: x.card_id,
        p_part_id: P.air,
        p_qty: 1,
        p_reason: "Torn filter",
      }),
    );
    expect(await card(x.card_id)).toMatchObject({ parts_complete_at: null, needs_review_reason: "wrong_fitment: T-SHOE" });

    // Close without drop is refused while it is set.
    const open = await closeCard(x.card_id);
    expectCode(open, "OPEN_LINES");
    expect(detail(open).needs_review_reason).toBe("wrong_fitment: T-SHOE");

    expectOk(await rpc(ncrManager, "clear_needs_review", { p_card_id: x.card_id, p_reason: "Fitted the old shoe" }));
    const after = await card(x.card_id);
    expect(after.needs_review_reason).toBeNull();
    expect(after.parts_complete_at).not.toBeNull();
  });

  it("wrong_fitment upserts a learned row; a manager's line clears needs review", async () => {
    await stockIn(1, P.shoe);
    await stockIn(1);
    const x = await confirm(
      (await createBike("DL3SAE0007", [{ finding_type_id: FT.oil, qty: 1 }], ncrManager, M.pulsar, V.pulsarDisc))
        .card_id,
    );
    expectOk(await rpc(ncrManager, "add_job_card_line", { p_card_id: x.card_id, p_part_id: P.shoe, p_qty: 1 }));
    const shoe = (await one<{ id: string }>(
      `select id from public.job_card_lines where job_card_id = $1 and part_id = $2`,
      [x.card_id, P.shoe],
    )).id;
    await arrive(x);
    await issueOk(shoe, 1);

    expectOk(await returnPart(shoe, 1, "wrong_fitment", { p_note: "Pulsar needs a pad" }));
    expect(await fitment(P.shoe, V.pulsarDisc)).toEqual({
      source: "learned",
      confirmed_count: 0,
      flagged_count: 1,
      last_flag_note: "Pulsar needs a pad",
    });
    expect((await card(x.card_id)).needs_review_reason).toBe("wrong_fitment: T-SHOE");

    await stockIn(1, P.pad);
    const added = expectOk<Card & { cleared_needs_review_reason: string }>(
      await rpc(ncrManager, "add_job_card_line", { p_card_id: x.card_id, p_part_id: P.pad, p_qty: 1 }),
    );
    expect(added.cleared_needs_review_reason).toBe("wrong_fitment: T-SHOE");
    const after = await card(x.card_id);
    expect(after.needs_review_reason).toBeNull();
    expect(after.parts_complete_at).not.toBeNull();
  });

  it("wrong_fitment while another bike waits reserves the returned unit for that bike", async () => {
    await stockIn(1, P.shoe);
    const x = await shoeCard("DL3SAE0008");
    const y = await shoeCard("DL3SAE0009");
    await arrive(x);
    await issueOk(shoeLine(x), 1);

    const res = expectOk<ReturnResult>(
      await returnPart(shoeLine(x), 1, "wrong_fitment", { p_note: "Does not fit this hub" }),
    );
    expect(res.allocated).toEqual([expect.objectContaining({ line_id: shoeLine(y), card_code: y.code, qty: 1 })]);
    expect(await line(shoeLine(y))).toMatchObject({ qty_reserved: 1, status: "reserved" });
    expect((await card(y.card_id)).parts_complete_at).not.toBeNull();
  });

  it("refuses more than net issued, bad bins, and closed cards", async () => {
    await stockIn(2);
    const x = await oilCard("DL3SAE0010", 1);
    await toRepair(x);
    expectCode(await returnPart(oilLine(x), 1, "not_needed"), "RETURN_EXCEEDS_ISSUED");
    await issueOk(oilLine(x), 1);

    const over = await returnPart(oilLine(x), 2, "not_needed");
    expectCode(over, "RETURN_EXCEEDS_ISSUED");
    expect(detail(over)).toEqual({ net_issued: 1, qty: 2 });
    expectCode(
      await rpc(ncrStore, "return_from_job_card", { p_line_id: oilLine(x), p_qty: 1, p_reason: "not_needed" }),
      "VALIDATION",
    );
    expectCode(await returnPart(oilLine(x), 1, "lost"), "VALIDATION");
    expectCode(await returnPart(oilLine(x), 1, "not_needed", { p_to_bin_id: ncr.qrn }), "BIN_KIND_NOT_ALLOWED");
    expectCode(await returnPart(oilLine(x), 1, "not_needed", { p_to_bin_id: jpr.normal }), "NOT_FOUND");
    expectCode(
      await rpc(jprStore, "return_from_job_card", {
        p_line_id: oilLine(x),
        p_qty: 1,
        p_reason: "not_needed",
        p_to_bin_id: jpr.normal,
      }),
      "NOT_FOUND",
    );

    expectOk(await closeCard(x.card_id));
    expectCode(await returnPart(oilLine(x), 1, "not_needed"), "JOB_CARD_NOT_CONFIRMED");
  });
});

describe("learned fitment through issue, return and close (SPEC §9.3)", () => {
  it("test 8: two bins, a mistaken issue returned and a replayed request add exactly 1", async () => {
    await stockIn(1, P.shoe, ncr.normal);
    await stockIn(1, P.shoe, BIN2);
    const x = await shoeCard("DL3SAF0001", 2);
    expect(lineOf(x, "T-SHOE")).toMatchObject({ qty_required: 2, qty_reserved: 2 });
    await toRepair(x);

    await issueOk(shoeLine(x), 1, ncr.normal);
    await issueOk(shoeLine(x), 1, BIN2);
    const back = expectOk<ReturnResult>(await returnPart(shoeLine(x), 1, "issued_by_mistake"));
    expect(back.line).toMatchObject({ qty_reserved: 1, net_issued: 1 });

    const rid = uuidv4();
    const first = expectOk<IssueResult>(await issue(shoeLine(x), 1, ncr.normal, rid));
    const replay = expectOk<IssueResult>(await issue(shoeLine(x), 1, ncr.normal, rid));
    expect(replay).toEqual(first);
    const moves = await one<{ n: number; qty: number }>(
      `select count(*)::int as n, sum(qty)::int as qty from public.stock_moves
       where move_type = 'issue' and job_card_line_id = $1`,
      [shoeLine(x)],
    );
    expect(moves).toEqual({ n: 3, qty: 3 });

    expect(await fitment(P.shoe, V.splendorDrum)).toMatchObject({ confirmed_count: 0 });
    expectOk(await closeCard(x.card_id));
    expect(await fitment(P.shoe, V.splendorDrum)).toMatchObject({ confirmed_count: 1, source: "catalogue" });
  });
});

describe("job card rules with real issues (test 10)", () => {
  it("refuses set_line_qty, cancel_job_card and cancel_bike while parts are issued; close learns", async () => {
    await stockIn(1, P.shoe);
    await stockIn(1);
    const x = await confirm(
      (
        await createBike("DL3SAG0001", [
          { finding_type_id: FT.brake },
          { finding_type_id: FT.oil, qty: 1 },
        ])
      ).card_id,
    );
    await toRepair(x);
    await issueOk(shoeLine(x), 1);
    await issueOk(oilLine(x), 1);

    const qty = await rpc(ncrManager, "set_line_qty", { p_line_id: shoeLine(x), p_qty: 0, p_reason: "Not needed" });
    expectCode(qty, "RETURN_PARTS_FIRST");
    expect(detail(qty)).toEqual({ net_issued: 1, qty: 0 });

    const cancel = await rpc(ncrManager, "cancel_job_card", { p_card_id: x.card_id, p_reason: "Bike sold as is" });
    expectCode(cancel, "ISSUED_PARTS_OUTSTANDING");
    expect(detail(cancel).lines.map((l: { sku: string }) => l.sku)).toEqual(["T-OIL", "T-SHOE"]);
    expectCode(
      await rpc(ncrManager, "cancel_bike", { p_bike_id: x.bike_id, p_reason: "Bike sold as is" }),
      "ISSUED_PARTS_OUTSTANDING",
    );

    const before = await fitments();
    expectOk(await closeCard(x.card_id));
    expect((await card(x.card_id)).status).toBe("closed");
    // +1 for the non-universal shoe on a known variant; nothing for the universal oil.
    expect(await fitment(P.shoe, V.splendorDrum)).toMatchObject({ confirmed_count: 1 });
    expect(await fitment(P.oil, V.splendorDrum)).toBeUndefined();
    expect((await fitments()).length).toBe(before.length);
  });

  it("learns nothing for a bike with an unknown variant", async () => {
    await stockIn(1, P.shoe);
    await stockIn(1);
    const x = await confirm(
      (await createBike("DL3SAG0002", [{ finding_type_id: FT.oil, qty: 1 }], ncrManager, M.splendor, null)).card_id,
    );
    expectOk(await rpc(ncrManager, "add_job_card_line", { p_card_id: x.card_id, p_part_id: P.shoe, p_qty: 1 }));
    const shoe = (await one<{ id: string }>(
      `select id from public.job_card_lines where job_card_id = $1 and part_id = $2`,
      [x.card_id, P.shoe],
    )).id;
    await toRepair(x);
    await issueOk(shoe, 1);
    await issueOk(oilLine(x), 1);

    const before = await fitments();
    expectOk(await closeCard(x.card_id));
    expect(await fitments()).toEqual(before);
  });
});

describe("fit_badge (SPEC §9.2)", () => {
  it("is green for a catalogue fitment and a universal part, amber without a confirmed fitment", async () => {
    const x = await confirm(
      (
        await createBike("DL3SAH0001", [
          { finding_type_id: FT.brake },
          { finding_type_id: FT.oil, qty: 1 },
        ])
      ).card_id,
    );
    expect(await badge(shoeLine(x))).toEqual([
      { badge: "green", confirmed_count: 0, flagged_count: 0, last_flag_note: null },
    ]);
    expect(await badge(oilLine(x))).toEqual([
      { badge: "green", confirmed_count: 0, flagged_count: 0, last_flag_note: null },
    ]);

    // Pad has no fitment to the Splendor; T-SHOE3 has only an unconfirmed learned row.
    for (const part of [P.pad, P.shoe3]) {
      expectOk(await rpc(ncrManager, "add_job_card_line", { p_card_id: x.card_id, p_part_id: part, p_qty: 1 }));
    }
    const lines = (
      await db.query<{ sku: string; id: string }>(
        `select p.sku, l.id from public.job_card_lines l join public.parts p on p.id = l.part_id
         where l.job_card_id = $1`,
        [x.card_id],
      )
    ).rows;
    const lineFor = (sku: string) => lines.find((l) => l.sku === sku)!.id;
    expect((await badge(lineFor("T-PAD")))[0].badge).toBe("amber");
    expect((await badge(lineFor("T-SHOE3")))[0].badge).toBe("amber");

    // 0 < flagged < confirmed: amber; flagged >= max(1, confirmed): red with the note.
    await db.query(
      `update public.part_fitments set confirmed_count = 3, flagged_count = 1, last_flag_note = 'Check drum size'
       where part_id = $1 and variant_id = $2`,
      [P.shoe, V.splendorDrum],
    );
    expect(await badge(shoeLine(x))).toEqual([
      { badge: "amber", confirmed_count: 3, flagged_count: 1, last_flag_note: "Check drum size" },
    ]);
    await db.query(`update public.part_fitments set flagged_count = 3 where part_id = $1 and variant_id = $2`, [
      P.shoe,
      V.splendorDrum,
    ]);
    expect((await badge(shoeLine(x)))[0]).toMatchObject({ badge: "red", flagged_count: 3 });

    // Red even for a universal part.
    await db.query(
      `insert into public.part_fitments (part_id, variant_id, source, flagged_count) values ($1, $2, 'learned', 1)`,
      [P.oil, V.splendorDrum],
    );
    expect((await badge(oilLine(x)))[0].badge).toBe("red");

    // RLS: another workshop's line returns no row.
    expect(await badge(shoeLine(x), jprStore)).toEqual([]);
  });

  it("is amber for an unknown variant unless the part is universal", async () => {
    const x = await confirm(
      (await createBike("DL3SAH0002", [{ finding_type_id: FT.oil, qty: 1 }], ncrManager, M.splendor, null)).card_id,
    );
    expectOk(await rpc(ncrManager, "add_job_card_line", { p_card_id: x.card_id, p_part_id: P.shoe, p_qty: 1 }));
    const shoe = (await one<{ id: string }>(
      `select id from public.job_card_lines where job_card_id = $1 and part_id = $2`,
      [x.card_id, P.shoe],
    )).id;
    expect((await badge(shoe))[0].badge).toBe("amber");
    expect((await badge(oilLine(x)))[0].badge).toBe("green");
  });
});

describe("log_app_error (SPEC §11.1, test 11)", () => {
  it("logs a failed request, which can still be retried with the same request_id", async () => {
    const x = await oilCard("DL3SAJ0001", 1);
    await arrive(x);
    const rid = uuidv4();
    expectCode(await issue(oilLine(x), 1, ncr.normal, rid), "INSUFFICIENT_RESERVATION");

    const logged = await ncrStore.rpc("log_app_error", {
      p_route: "/store/issue",
      p_code: "INSUFFICIENT_RESERVATION",
      p_message: "Not enough reserved",
      p_ref_request_id: rid,
    });
    expect(logged.error).toBeNull();
    expect(logged.data).toEqual({ id: expect.any(Number) });

    const rows = await admin.from("app_errors").select("user_id, route, code, message").eq("request_id", rid);
    expect(rows.data).toEqual([
      {
        user_id: "00000000-0000-0000-0000-0000000000b2",
        route: "/store/issue",
        code: "INSUFFICIENT_RESERVATION",
        message: "Not enough reserved",
      },
    ]);
    expect((await ncrStore.from("app_errors").select("id")).data).toEqual([]);
    const idem = await one<{ n: number }>(`select count(*)::int as n from public.idempotency where request_id = $1`, [
      rid,
    ]);
    expect(idem.n).toBe(0);

    expectOk(
      await rpc(ncrManager, "adjust_stock", {
        p_bin_id: ncr.normal,
        p_part_id: P.oil,
        p_counted_qty: 1,
        p_expected_on_hand: 0,
        p_reason: "found",
      }),
    );
    const retried = expectOk<IssueResult>(await issue(oilLine(x), 1, ncr.normal, rid));
    expect(retried.line).toMatchObject({ qty_issued: 1, status: "issued" });
  });

  it("validates input, truncates long messages and refuses anon", async () => {
    const blank = await ncrStore.rpc("log_app_error", { p_route: " ", p_code: "X", p_message: "m" });
    expect(blank.error?.message).toBe("VALIDATION");
    const long = await jprManager.rpc("log_app_error", { p_route: "/x", p_code: "X", p_message: "m".repeat(3000) });
    expect(long.error).toBeNull();
    const row = await one<{ len: number; request_id: string | null }>(
      `select char_length(message) as len, request_id from public.app_errors where id = $1`,
      [(long.data as { id: number }).id],
    );
    expect(row).toEqual({ len: 2000, request_id: null });

    const anon = await anonClient().rpc("log_app_error", { p_route: "/x", p_code: "X", p_message: "m" });
    expect(anon.error).not.toBeNull();
  });
});
