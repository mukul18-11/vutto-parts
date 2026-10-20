// Job card lifecycle after confirm (SPEC §5.2, §6, §9.3) and the stock engine with reservations
// (SPEC §8.4), acting as the demo users. Cards are made with create_bike + confirm_job_card.
// Issued parts (Prompt 6) are simulated by inserting the issue move as postgres.
// No concurrency tests: the user dropped them for this prompt.
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clientAs, pgClient, type Client } from "./clients";
import { insertBins, testClear } from "./fixtures";
import { expectInvariantsHold } from "./invariants";
import {
  BIN2,
  confirmAs,
  createBikeAs,
  detail,
  expectCode,
  expectOk,
  FT,
  insertJobCardCatalog,
  lineOf,
  M,
  ncr,
  P,
  queryOne,
  rpc,
  stockIn as stockInAs,
  V,
  type Card,
  type Finding,
} from "./job-card-fixtures";

let db: pg.Client;
let ncrManager: Client;
let ncrStore: Client;
let jprManager: Client;

const createBike = (reg: string, findings: Finding[], c?: Client, model = M.splendor, variant = V.splendorDrum) =>
  createBikeAs(c ?? ncrManager, reg, model, variant, findings);
const confirm = (card: string, c?: Client) => confirmAs(c ?? ncrManager, card);
const stockIn = (qty: number, part: string = P.oil, bin: string = ncr.normal) => stockInAs(db, qty, part, bin);
const one = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => queryOne<T>(db, sql, params);

/** A confirmed card for an engine oil finding of the given qty. */
async function oilCard(reg: string, qty = 2): Promise<Card> {
  const card = await createBike(reg, [{ finding_type_id: FT.oil, qty }]);
  return confirm(card.card_id);
}

async function line(lineId: string) {
  return one<{ qty_required: number; qty_reserved: number; status: string; cancelled_at: string | null }>(
    `select qty_required, qty_reserved, status, cancelled_at from public.job_card_lines where id = $1`,
    [lineId],
  );
}

async function card(cardId: string) {
  return one<{ status: string; parts_complete_at: string | null; needs_review_reason: string | null }>(
    `select status, parts_complete_at::text, needs_review_reason from public.job_cards where id = $1`,
    [cardId],
  );
}

/** Issue as postgres (issue_to_job_card arrives in Prompt 6): move out of the bin, reserved -> issued. */
async function issueAsPostgres(lineId: string, qty: number, bin: string = ncr.normal) {
  await db.query(
    `insert into public.stock_moves (workshop_id, part_id, move_type, qty, from_bin_id, job_card_line_id, user_id)
     select l.workshop_id, l.part_id, 'issue', $2, $3, l.id, $4 from public.job_card_lines l where l.id = $1`,
    [lineId, qty, bin, "00000000-0000-0000-0000-0000000000b2"],
  );
  await db.query(
    `update public.job_card_lines set qty_reserved = qty_reserved - $2, qty_issued = qty_issued + $2 where id = $1`,
    [lineId, qty],
  );
}

async function toRepair(c: Card) {
  expectOk(await rpc(ncrStore, "mark_arrived", { p_bike_id: c.bike_id }));
  expectOk(await rpc(ncrManager, "start_repair", { p_bike_id: c.bike_id }));
}

async function fitments() {
  return (
    await db.query(
      `select part_id, variant_id, source, confirmed_count, flagged_count from public.part_fitments
       order by part_id, variant_id`,
    )
  ).rows;
}

beforeAll(async () => {
  db = await pgClient();
  ncrManager = await clientAs("ncr_manager");
  ncrStore = await clientAs("ncr_store");
  jprManager = await clientAs("jpr_manager");
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

describe("add_job_card_line", () => {
  it("lets a store keeper add an extra part with a reason, allocated at once", async () => {
    await stockIn(3, P.air);
    const c = await oilCard("DL3SAC0001");
    expectCode(
      await rpc(ncrStore, "add_job_card_line", { p_card_id: c.card_id, p_part_id: P.air, p_qty: 1 }),
      "VALIDATION",
    );
    const res = expectOk<Card>(
      await rpc(ncrStore, "add_job_card_line", {
        p_card_id: c.card_id,
        p_part_id: P.air,
        p_qty: 1,
        p_reason: "Mechanic found torn filter",
      }),
    );
    expect(lineOf(res, "T-AIR")).toMatchObject({ source: "extra", qty_required: 1, qty_reserved: 1 });
    const added = await one(`select added_reason from public.job_card_lines where id = $1`, [
      lineOf(res, "T-AIR").line_id,
    ]);
    expect(added.added_reason).toBe("Mechanic found torn filter");

    // Same part again: qty_required grows on the same line.
    const again = expectOk<Card>(
      await rpc(ncrManager, "add_job_card_line", { p_card_id: c.card_id, p_part_id: P.air, p_qty: 2 }),
    );
    expect(lineOf(again, "T-AIR")).toMatchObject({ qty_required: 3, qty_reserved: 3, source: "extra" });
    expect(again.lines).toHaveLength(2);
  });

  it("refuses draft cards and other workshops", async () => {
    const draft = await createBike("DL3SAC0002", []);
    expectCode(
      await rpc(ncrManager, "add_job_card_line", { p_card_id: draft.card_id, p_part_id: P.air, p_qty: 1 }),
      "JOB_CARD_NOT_CONFIRMED",
    );
    const c = await confirm(draft.card_id);
    expectCode(
      await rpc(jprManager, "add_job_card_line", { p_card_id: c.card_id, p_part_id: P.air, p_qty: 1 }),
      "NOT_FOUND",
    );
    expectCode(
      await rpc(ncrManager, "add_job_card_line", { p_card_id: c.card_id, p_part_id: P.air, p_qty: 0 }),
      "VALIDATION",
    );
  });

  it("clears needs_review_reason only for a manager's line; clear_needs_review clears it too", async () => {
    await stockIn(2);
    const c = await oilCard("DL3SAC0003");
    const flag = () =>
      db.query(`update public.job_cards set needs_review_reason = 'wrong_fitment: T-SHOE', parts_complete_at = null where id = $1`, [
        c.card_id,
      ]);
    await flag();

    expectOk(
      await rpc(ncrStore, "add_job_card_line", {
        p_card_id: c.card_id,
        p_part_id: P.air,
        p_qty: 1,
        p_reason: "Extra",
      }),
    );
    expect((await card(c.card_id)).needs_review_reason).toBe("wrong_fitment: T-SHOE");

    const res = expectOk<{ cleared_needs_review_reason: string }>(
      await rpc(ncrManager, "add_job_card_line", { p_card_id: c.card_id, p_part_id: P.shoe2, p_qty: 1 }),
    );
    expect(res.cleared_needs_review_reason).toBe("wrong_fitment: T-SHOE");
    expect((await card(c.card_id)).needs_review_reason).toBeNull();

    // Remove the uncovered lines so only the review flag decides completeness.
    const lines = (await db.query(`select id, part_id from public.job_card_lines where job_card_id = $1`, [c.card_id]))
      .rows as { id: string; part_id: string }[];
    for (const l of lines.filter((x) => x.part_id !== P.oil)) {
      expectOk(await rpc(ncrManager, "set_line_qty", { p_line_id: l.id, p_qty: 0, p_reason: "Not needed" }));
    }
    expect((await card(c.card_id)).parts_complete_at).not.toBeNull();

    await flag();
    expectCode(await rpc(ncrManager, "clear_needs_review", { p_card_id: c.card_id, p_reason: " " }), "VALIDATION");
    expectCode(
      await rpc(ncrStore, "clear_needs_review", { p_card_id: c.card_id, p_reason: "Checked" }),
      "FORBIDDEN",
    );
    const cleared = expectOk<{ cleared_needs_review_reason: string }>(
      await rpc(ncrManager, "clear_needs_review", { p_card_id: c.card_id, p_reason: "Part fits after all" }),
    );
    expect(cleared.cleared_needs_review_reason).toBe("wrong_fitment: T-SHOE");
    const after = await card(c.card_id);
    expect(after.needs_review_reason).toBeNull();
    expect(after.parts_complete_at).not.toBeNull();
  });
});

describe("set_line_qty (test 6)", () => {
  it("decrease releases to the next waiting bike, increase reserves at once, 0 cancels", async () => {
    await stockIn(2);
    const a = await oilCard("DL3SAC0101", 2);
    const b = await oilCard("DL3SAC0102", 1);
    const aLine = lineOf(a, "T-OIL").line_id;
    const bLine = lineOf(b, "T-OIL").line_id;
    expect(await line(aLine)).toMatchObject({ qty_reserved: 2 });
    expect(await line(bLine)).toMatchObject({ qty_reserved: 0 });
    expect((await card(b.card_id)).parts_complete_at).toBeNull();

    const dec = expectOk<{ allocated: { line_id: string; qty: number }[] }>(
      await rpc(ncrManager, "set_line_qty", { p_line_id: aLine, p_qty: 1, p_reason: "Only one needed" }),
    );
    expect(dec.allocated).toEqual([expect.objectContaining({ line_id: bLine, qty: 1 })]);
    expect(await line(aLine)).toMatchObject({ qty_required: 1, qty_reserved: 1 });
    expect(await line(bLine)).toMatchObject({ qty_reserved: 1, status: "reserved" });
    expect((await card(b.card_id)).parts_complete_at).not.toBeNull();
    expect((await card(a.card_id)).parts_complete_at).not.toBeNull();

    // Increase while free stock exists: reserved at once.
    await stockIn(2);
    expectOk(await rpc(ncrManager, "set_line_qty", { p_line_id: aLine, p_qty: 3, p_reason: "Top-up too" }));
    expect(await line(aLine)).toMatchObject({ qty_required: 3, qty_reserved: 3, status: "reserved" });

    // Increase with no free stock: the card becomes incomplete.
    expectOk(await rpc(ncrManager, "set_line_qty", { p_line_id: aLine, p_qty: 4, p_reason: "Bigger sump" }));
    expect(await line(aLine)).toMatchObject({ qty_required: 4, qty_reserved: 3 });
    expect((await card(a.card_id)).parts_complete_at).toBeNull();

    // 0 cancels B's line; its unit goes to A, and B (no live lines) is complete.
    expectOk(await rpc(ncrManager, "set_line_qty", { p_line_id: bLine, p_qty: 0, p_reason: "Oil was fine" }));
    const bAfter = await line(bLine);
    expect(bAfter).toMatchObject({ qty_required: 0, qty_reserved: 0, status: "cancelled" });
    expect(bAfter.cancelled_at).not.toBeNull();
    expect(await line(aLine)).toMatchObject({ qty_reserved: 4 });
    expect((await card(a.card_id)).parts_complete_at).not.toBeNull();
    expect((await card(b.card_id)).parts_complete_at).not.toBeNull();
    expectCode(
      await rpc(ncrManager, "set_line_qty", { p_line_id: bLine, p_qty: 1, p_reason: "Back" }),
      "LINE_CANCELLED",
    );
  });

  it("refuses below net_issued, without a reason, for store keepers and on draft cards", async () => {
    await stockIn(2);
    const a = await oilCard("DL3SAC0103", 2);
    const aLine = lineOf(a, "T-OIL").line_id;
    await issueAsPostgres(aLine, 1);
    const res = await rpc(ncrManager, "set_line_qty", { p_line_id: aLine, p_qty: 0, p_reason: "Not needed" });
    expectCode(res, "RETURN_PARTS_FIRST");
    expect(detail(res).net_issued).toBe(1);
    expectOk(await rpc(ncrManager, "set_line_qty", { p_line_id: aLine, p_qty: 1, p_reason: "One is enough" }));
    expect(await line(aLine)).toMatchObject({ qty_required: 1, qty_reserved: 0, status: "issued" });

    expectCode(await rpc(ncrManager, "set_line_qty", { p_line_id: aLine, p_qty: 2, p_reason: "" }), "VALIDATION");
    expectCode(await rpc(ncrStore, "set_line_qty", { p_line_id: aLine, p_qty: 2, p_reason: "x" }), "FORBIDDEN");
    const draft = await createBike("DL3SAC0104", [{ finding_type_id: FT.oil }]);
    expectCode(
      await rpc(ncrManager, "set_line_qty", { p_line_id: lineOf(draft, "T-OIL").line_id, p_qty: 1, p_reason: "x" }),
      "JOB_CARD_NOT_CONFIRMED",
    );
  });
});

describe("reallocate_reservation (test 7)", () => {
  it("moves a reservation and recomputes both cards' completeness", async () => {
    await stockIn(2);
    const a = await oilCard("DL3SAC0201", 2);
    const b = await oilCard("DL3SAC0202", 2);
    const aLine = lineOf(a, "T-OIL").line_id;
    const bLine = lineOf(b, "T-OIL").line_id;
    expect((await card(a.card_id)).parts_complete_at).not.toBeNull();

    const res = expectOk<{ from: { card_code: string; qty_reserved: number }; to: { qty_reserved: number } }>(
      await rpc(ncrManager, "reallocate_reservation", {
        p_from_line_id: aLine,
        p_to_line_id: bLine,
        p_qty: 2,
        p_reason: "B is on the lift",
      }),
    );
    expect(res).toMatchObject({ from: { card_code: a.code, qty_reserved: 0 }, to: { qty_reserved: 2 } });
    expect(await line(aLine)).toMatchObject({ qty_reserved: 0 });
    expect(await line(bLine)).toMatchObject({ qty_reserved: 2 });
    expect((await card(a.card_id)).parts_complete_at).toBeNull();
    expect((await card(b.card_id)).parts_complete_at).not.toBeNull();
  });

  it("validates qty, part, workshop, card state and role", async () => {
    await stockIn(3);
    const a = await oilCard("DL3SAC0203", 2); // reserved 2
    const b = await oilCard("DL3SAC0204", 2); // reserved 1, uncovered 1
    const aLine = lineOf(a, "T-OIL").line_id;
    const bLine = lineOf(b, "T-OIL").line_id;
    const move = (from: string, to: string, qty: number, c: Client = ncrManager) =>
      rpc(c, "reallocate_reservation", { p_from_line_id: from, p_to_line_id: to, p_qty: qty, p_reason: "Swap" });

    expectCode(await move(aLine, bLine, 3), "VALIDATION"); // > from reserved (2)
    expectCode(await move(aLine, bLine, 2), "VALIDATION"); // > to uncovered (1)
    expectCode(await move(bLine, aLine, 1), "VALIDATION"); // a has nothing uncovered
    expectCode(await move(aLine, aLine, 1), "VALIDATION");

    const shoeCard = await confirm(
      (await createBike("DL3SAC0205", [{ finding_type_id: FT.brake }])).card_id,
    );
    expectCode(await move(aLine, lineOf(shoeCard, "T-SHOE").line_id, 1), "VALIDATION");

    const draft = await createBike("DL3SAC0206", [{ finding_type_id: FT.oil }]);
    expectCode(await move(aLine, lineOf(draft, "T-OIL").line_id, 1), "VALIDATION");

    const jpr = await createBikeAs(jprManager, "RJ14AC0207", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    const jprCard = await confirm(jpr.card_id, jprManager);
    expectCode(await move(aLine, lineOf(jprCard, "T-OIL").line_id, 1), "NOT_FOUND");
    expectCode(await move(lineOf(jprCard, "T-OIL").line_id, aLine, 1), "NOT_FOUND");

    expectCode(await move(aLine, bLine, 1, ncrStore), "FORBIDDEN");
    expect(await line(aLine)).toMatchObject({ qty_reserved: 2 });
    expect(await line(bLine)).toMatchObject({ qty_reserved: 1 });
  });
});

describe("cancel_job_card, create_job_card, cancel_bike (test 8)", () => {
  it("cancels, re-creates a card from the findings, and refuses ready bikes", async () => {
    await stockIn(2);
    const a = await oilCard("DL3SAC0301", 2);
    const b = await oilCard("DL3SAC0302", 2);
    const bLine = lineOf(b, "T-OIL").line_id;

    expectCode(await rpc(ncrManager, "cancel_job_card", { p_card_id: a.card_id, p_reason: "" }), "VALIDATION");
    const cancelled = expectOk<{ allocated: { line_id: string; qty: number }[] }>(
      await rpc(ncrManager, "cancel_job_card", { p_card_id: a.card_id, p_reason: "Customer bought elsewhere" }),
    );
    expect(cancelled.allocated).toEqual([expect.objectContaining({ line_id: bLine, qty: 2 })]);
    expect(await card(a.card_id)).toMatchObject({ status: "cancelled", parts_complete_at: null });
    expect(await line(lineOf(a, "T-OIL").line_id)).toMatchObject({ status: "cancelled", qty_reserved: 0 });
    expect((await card(b.card_id)).parts_complete_at).not.toBeNull();
    expectCode(
      await rpc(ncrManager, "cancel_job_card", { p_card_id: a.card_id, p_reason: "Again" }),
      "INVALID_TRANSITION",
    );

    // A new card for the arrived bike, suggested from its existing finding.
    expectOk(await rpc(ncrStore, "mark_arrived", { p_bike_id: a.bike_id }));
    const fresh = expectOk<Card & { created: boolean }>(
      await rpc(ncrManager, "create_job_card", { p_bike_id: a.bike_id }),
    );
    expect(fresh).toMatchObject({ status: "draft", created: true, unresolved_findings: [] });
    expect(fresh.card_id).not.toBe(a.card_id);
    expect(fresh.code).not.toBe(a.code);
    expect(fresh.lines.map((l) => [l.sku, l.source, l.qty_required])).toEqual([["T-OIL", "suggested", 2]]);
    expect(lineOf(fresh, "T-OIL").finding_ids).toEqual(lineOf(a, "T-OIL").finding_ids);

    const same = expectOk<Card & { created: boolean }>(
      await rpc(ncrManager, "create_job_card", { p_bike_id: a.bike_id }),
    );
    expect(same).toMatchObject({ card_id: fresh.card_id, created: false });

    await confirm(fresh.card_id);
    expectOk(await rpc(ncrManager, "start_repair", { p_bike_id: a.bike_id }));

    // B to ready via close with drop_remaining; then both RPCs refuse it.
    await toRepair(b);
    expectOk(
      await rpc(ncrManager, "close_job_card", {
        p_card_id: b.card_id,
        p_drop_remaining: true,
        p_reason: "Sold as is",
      }),
    );
    expectCode(await rpc(ncrManager, "create_job_card", { p_bike_id: b.bike_id }), "BIKE_NOT_ACTIVE");
    expectCode(
      await rpc(ncrManager, "cancel_bike", { p_bike_id: b.bike_id, p_reason: "Too late" }),
      "INVALID_TRANSITION",
    );
    // B's released units went to A's new card.
    expect(await line(lineOf(fresh, "T-OIL").line_id)).toMatchObject({ qty_reserved: 2 });
  });

  it("refuses to cancel while parts are issued", async () => {
    await stockIn(2);
    const a = await oilCard("DL3SAC0303", 2);
    await issueAsPostgres(lineOf(a, "T-OIL").line_id, 1);
    const res = await rpc(ncrManager, "cancel_job_card", { p_card_id: a.card_id, p_reason: "Changed mind" });
    expectCode(res, "ISSUED_PARTS_OUTSTANDING");
    expect(detail(res).lines).toEqual([expect.objectContaining({ sku: "T-OIL", net_issued: 1 })]);
    expectCode(
      await rpc(ncrManager, "cancel_bike", { p_bike_id: a.bike_id, p_reason: "Changed mind" }),
      "ISSUED_PARTS_OUTSTANDING",
    );
    expect(await card(a.card_id)).toMatchObject({ status: "confirmed" });
  });

  it("cancels a draft card and a bike, and refuses store keepers", async () => {
    const d = await createBike("DL3SAC0304", [{ finding_type_id: FT.oil }]);
    expectCode(
      await rpc(ncrStore, "cancel_bike", { p_bike_id: d.bike_id, p_reason: "Not bought" }),
      "FORBIDDEN",
    );
    expectOk(await rpc(ncrManager, "cancel_bike", { p_bike_id: d.bike_id, p_reason: "Deal fell through" }));
    const bike = await one(`select status, cancel_reason, cancelled_at is not null as at from public.bikes where id = $1`, [
      d.bike_id,
    ]);
    expect(bike).toEqual({ status: "cancelled", cancel_reason: "Deal fell through", at: true });
    expect(await card(d.card_id)).toMatchObject({ status: "cancelled" });
    expectCode(await rpc(ncrManager, "create_job_card", { p_bike_id: d.bike_id }), "BIKE_NOT_ACTIVE");
    expectCode(
      await rpc(ncrManager, "cancel_bike", { p_bike_id: d.bike_id, p_reason: "Again" }),
      "INVALID_TRANSITION",
    );
  });
});

describe("close_job_card (test 9)", () => {
  it("lists open lines, then drop_remaining closes and releases everything", async () => {
    await stockIn(1);
    const draft = await createBike("DL3SAC0401", [{ finding_type_id: FT.oil }, { finding_type_id: FT.brake }]);
    const c = await confirm(draft.card_id);
    expect(lineOf(c, "T-OIL")).toMatchObject({ qty_reserved: 1 });

    expectCode(
      await rpc(ncrManager, "close_job_card", { p_card_id: c.card_id, p_drop_remaining: true, p_reason: "x" }),
      "INVALID_TRANSITION",
    );
    await toRepair(c);

    const open = await rpc(ncrManager, "close_job_card", { p_card_id: c.card_id, p_drop_remaining: false });
    expectCode(open, "OPEN_LINES");
    expect(detail(open).lines.map((l: { sku: string }) => l.sku)).toEqual(["T-OIL", "T-SHOE"]);
    expectCode(
      await rpc(ncrManager, "close_job_card", { p_card_id: c.card_id, p_drop_remaining: true }),
      "VALIDATION",
    );

    const before = await fitments();
    expectOk(
      await rpc(ncrManager, "close_job_card", {
        p_card_id: c.card_id,
        p_drop_remaining: true,
        p_reason: "Parts not worth waiting for",
      }),
    );
    const closed = await one<{ status: string; same: boolean; bike: string; ready: boolean }>(
      `select c.status, c.parts_complete_at = c.closed_at as same, b.status as bike, b.ready_at is not null as ready
       from public.job_cards c join public.bikes b on b.id = c.bike_id where c.id = $1`,
      [c.card_id],
    );
    expect(closed).toEqual({ status: "closed", same: true, bike: "ready", ready: true });
    const lines = await db.query(
      `select qty_required, qty_reserved, status from public.job_card_lines where job_card_id = $1`,
      [c.card_id],
    );
    expect(lines.rows).toEqual([
      { qty_required: 0, qty_reserved: 0, status: "cancelled" },
      { qty_required: 0, qty_reserved: 0, status: "cancelled" },
    ]);
    expect(await fitments()).toEqual(before);
    expectCode(
      await rpc(ncrManager, "close_job_card", { p_card_id: c.card_id, p_drop_remaining: false }),
      "JOB_CARD_NOT_CONFIRMED",
    );
  });

  it("closes a fully issued card and learns fitments", async () => {
    await stockIn(2, P.shoe);
    // Splendor: catalogue shoe. Pulsar: the shoe is added by hand (no fitment row yet).
    const s = await confirm((await createBike("DL3SAC0402", [{ finding_type_id: FT.brake }])).card_id);
    const pDraft = await createBike("DL3SAC0403", [], undefined, M.pulsar, V.pulsarDisc);
    const p = await confirm(pDraft.card_id);
    const added = expectOk<Card>(
      await rpc(ncrManager, "add_job_card_line", { p_card_id: p.card_id, p_part_id: P.shoe, p_qty: 1 }),
    );
    expect(lineOf(added, "T-SHOE")).toMatchObject({ source: "manual", qty_reserved: 1 });

    for (const [c, l] of [
      [s, lineOf(s, "T-SHOE").line_id],
      [p, lineOf(added, "T-SHOE").line_id],
    ] as const) {
      await toRepair(c);
      await issueAsPostgres(l, 1);
      const res = expectOk<{ learned_fitments: number }>(
        await rpc(ncrManager, "close_job_card", { p_card_id: c.card_id, p_drop_remaining: false }),
      );
      expect(res.learned_fitments).toBe(1);
    }

    const rows = await db.query(
      `select variant_id, source, confirmed_count from public.part_fitments where part_id = $1 order by source`,
      [P.shoe],
    );
    expect(rows.rows).toEqual([
      { variant_id: V.splendorDrum, source: "catalogue", confirmed_count: 1 },
      { variant_id: V.pulsarDisc, source: "learned", confirmed_count: 1 },
    ]);
  });

  it("refuses with OPEN_LINES while needs_review_reason is set unless dropping", async () => {
    await stockIn(2);
    const c = await oilCard("DL3SAC0404", 2);
    await toRepair(c);
    await issueAsPostgres(lineOf(c, "T-OIL").line_id, 2);
    await db.query(
      `update public.job_cards set needs_review_reason = 'wrong_fitment: T-OIL', parts_complete_at = null where id = $1`,
      [c.card_id],
    );
    const res = await rpc(ncrManager, "close_job_card", { p_card_id: c.card_id, p_drop_remaining: false });
    expectCode(res, "OPEN_LINES");
    expect(detail(res)).toMatchObject({ lines: [], needs_review_reason: "wrong_fitment: T-OIL" });
    expectOk(
      await rpc(ncrManager, "close_job_card", { p_card_id: c.card_id, p_drop_remaining: true, p_reason: "Fine" }),
    );
    const after = await card(c.card_id);
    expect(after).toMatchObject({ status: "closed", needs_review_reason: null });
    expect(after.parts_complete_at).not.toBeNull();
  });
});

describe("reg no reuse (test 12)", () => {
  it("rejects a duplicate active reg no and allows it after the first bike is cancelled", async () => {
    const first = await createBike("DL3SAC0501", []);
    const dup = await rpc(ncrManager, "create_bike", {
      p_workshop_id: null,
      p_reg_no: "dl 3s ac 0501",
      p_model_id: M.splendor,
      p_mfg_year: 2022,
      p_findings: [],
    });
    expectCode(dup, "VALIDATION");
    expect(detail(dup).reason).toBe("duplicate_reg_no");

    expectOk(await rpc(ncrManager, "cancel_bike", { p_bike_id: first.bike_id, p_reason: "Wrong entry" }));
    const second = await createBike("DL-3S-AC-0501", []);
    expect(second.bike_id).not.toBe(first.bike_id);
  });
});

describe("stock engine with reservations (test 13)", () => {
  it("keeps, releases and re-allocates reservations FIFO as stock moves", async () => {
    await stockIn(6);
    const cards: Card[] = [];
    for (const [reg, date] of [
      ["DL3SAC0601", "2026-10-21"],
      ["DL3SAC0602", "2026-10-22"],
      ["DL3SAC0603", "2026-10-25"],
    ]) {
      const d = await createBike(reg, [{ finding_type_id: FT.oil, qty: 2 }]);
      expectOk(await rpc(ncrManager, "set_needed_by", { p_card_id: d.card_id, p_date: date }));
      cards.push(await confirm(d.card_id));
    }
    const [c21, c22, c25] = cards;
    const reserved = async () => {
      const out: number[] = [];
      for (const c of cards) out.push((await line(lineOf(c, "T-OIL").line_id)).qty_reserved);
      return out;
    };
    expect(await reserved()).toEqual([2, 2, 2]);

    // Moving reserved stock between normal bins keeps every reservation.
    expectOk(
      await rpc(ncrStore, "move_stock", {
        p_part_id: P.oil,
        p_from_bin_id: ncr.normal,
        p_to_bin_id: BIN2,
        p_qty: 6,
        p_reason: null as never,
      }),
    );
    expect(await reserved()).toEqual([2, 2, 2]);

    // adjust_out below reserved: release in reverse FIFO, latest needed_by first.
    const out = expectOk<{ released: string[] }>(
      await rpc(ncrManager, "adjust_stock", {
        p_bin_id: BIN2,
        p_part_id: P.oil,
        p_counted_qty: 1,
        p_expected_on_hand: 6,
        p_reason: "lost",
      }),
    );
    expect(out.released).toEqual([c25.code, c22.code, c21.code]);
    expect(await reserved()).toEqual([1, 0, 0]);
    for (const c of cards) expect((await card(c.card_id)).parts_complete_at).toBeNull();

    // adjust_in into an empty bin: the oldest waiting line gets it.
    const inn = expectOk<{ allocated: { card_code: string; qty: number }[] }>(
      await rpc(ncrManager, "adjust_stock", {
        p_bin_id: ncr.normal,
        p_part_id: P.oil,
        p_counted_qty: 1,
        p_expected_on_hand: 0,
        p_reason: "found",
      }),
    );
    expect(inn.allocated.map((x) => [x.card_code, x.qty])).toEqual([[c21.code, 1]]);
    expect(await reserved()).toEqual([2, 0, 0]);
    expect((await card(c21.card_id)).parts_complete_at).not.toBeNull();

    // Move to quarantine: the excess reservation is released.
    const toQrn = expectOk<{ released: string[] }>(
      await rpc(ncrStore, "move_stock", {
        p_part_id: P.oil,
        p_from_bin_id: BIN2,
        p_to_bin_id: ncr.qrn,
        p_qty: 1,
        p_reason: "Leaking bottle",
      }),
    );
    expect(toQrn.released).toEqual([c21.code]);
    expect(await reserved()).toEqual([1, 0, 0]);

    // Out of quarantine: manager only, and it allocates.
    const back = { p_part_id: P.oil, p_from_bin_id: ncr.qrn, p_to_bin_id: ncr.normal, p_qty: 1, p_reason: "Seal fine" };
    expectCode(await rpc(ncrStore, "move_stock", back), "FORBIDDEN");
    const fromQrn = expectOk<{ allocated: { card_code: string; qty: number }[] }>(
      await rpc(ncrManager, "move_stock", back),
    );
    expect(fromQrn.allocated.map((x) => [x.card_code, x.qty])).toEqual([[c21.code, 1]]);
    expect(await reserved()).toEqual([2, 0, 0]);
  });
});
