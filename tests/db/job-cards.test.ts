// Bikes, findings and draft/confirmed job cards (SPEC §3.2, §5, §9.1, §11.1), acting as the demo
// users: suggestions, confirm and allocation, findings lock, bike transitions.
// Prompt 4 tests 4 and 11 (concurrent confirms, concurrent create_bike codes) are not written:
// the user dropped concurrency tests for this prompt.
import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/lib/database.types";
import { clientAs, pgClient, type Client } from "./clients";
import { DEMO_USERS, WORKSHOP_IDS } from "./demo-users";
import { insertBins, testClear, wsIds } from "./fixtures";
import { expectInvariantsHold } from "./invariants";

type Fns = Database["public"]["Functions"];
type Args<F extends keyof Fns> = Omit<Fns[F]["Args"], "p_request_id" | "p_workshop_id"> & {
  p_request_id?: string;
  p_workshop_id?: string | null;
};
type RpcResult = { data: unknown; error: { message: string; code?: string; details?: string } | null };

type Line = {
  line_id: string;
  part_id: string;
  sku: string;
  qty_required: number;
  qty_reserved: number;
  source: string;
  status: string;
  finding_ids: string[];
};
type Card = {
  card_id: string;
  code: string;
  status: string;
  bike_id: string;
  needed_by: string | null;
  parts_complete_at: string | null;
  lines: Line[];
  unresolved_findings: { finding_id: string; code: string }[];
  allocated?: { line_id: string; card_code: string; qty: number }[];
};
type Finding = { finding_type_id: string; qty?: number | null; notes?: string | null };

const NCR = WORKSHOP_IDS.NCR;
const ncr = wsIds("NCR");
const manager = DEMO_USERS.find((u) => u.key === "ncr_manager")!.id;
const id = (i: number) => `d1000000-0000-0000-0000-${String(i).padStart(12, "0")}`;

const M = { splendor: id(1), pulsar: id(2), classic: id(3) };
const V = { splendorDrum: id(11), pulsarDisc: id(12), classic: id(13) };
const P = { shoe: id(21), pad: id(22), oil: id(23), reOil: id(24), air: id(25), shoe2: id(26), shoe3: id(27) };
const FT = { brake: id(31), oil: id(32), topup: id(33), air: id(34), chain: id(35) };
const BIN2 = id(41);

let db: pg.Client;
let ncrManager: Client;
let ncrStore: Client;
let jprManager: Client;
let admin: Client;
let noProfile: Client;

const rpc = <F extends keyof Fns>(c: Client, fn: F, args: Args<F>) =>
  c.rpc(fn, { p_request_id: uuidv4(), ...args } as never) as unknown as Promise<RpcResult>;

function expectCode(res: RpcResult, code: string) {
  expect(res.error?.message, JSON.stringify(res.error)).toBe(code);
}

function expectOk<T = Record<string, unknown>>(res: RpcResult): T {
  expect(res.error, JSON.stringify(res.error)).toBeNull();
  return res.data as T;
}

const detail = (res: RpcResult) => JSON.parse(res.error?.details ?? "{}");

async function createBike(
  reg: string,
  model: string,
  variant: string | null,
  findings: Finding[],
  c: Client = ncrManager,
): Promise<Card> {
  return expectOk<Card>(
    await rpc(c, "create_bike", {
      p_workshop_id: null,
      p_reg_no: reg,
      p_model_id: model,
      p_mfg_year: 2022,
      p_findings: findings,
      ...(variant ? { p_variant_id: variant } : {}),
    }),
  );
}

const confirm = async (card: string) => expectOk<Card>(await rpc(ncrManager, "confirm_job_card", { p_card_id: card }));

const skus = (card: Card) => card.lines.map((l) => l.sku).sort();
const lineOf = (card: Card, sku: string) => card.lines.find((l) => l.sku === sku)!;

async function stockIn(qty: number, part: string = P.oil, bin: string = ncr.normal) {
  await db.query(
    `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, reason, user_id)
     values ($1, $2, 'adjust_in', $3, $4, 'found', $5)`,
    [NCR, part, qty, bin, manager],
  );
}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query(sql, params)).rows[0] as T;
}

async function insertJobCardCatalog() {
  await db.query(
    `insert into public.vehicle_models (id, make, model, segment) values
       ($1, 'Hero', 'Splendor Plus', 'motorcycle'),
       ($2, 'Bajaj', 'Pulsar 150', 'motorcycle'),
       ($3, 'Royal Enfield', 'Classic 350', 'motorcycle')`,
    [M.splendor, M.pulsar, M.classic],
  );
  await db.query(
    `insert into public.model_variants
       (id, model_id, name, year_from, year_to, brake_front, brake_rear, start_type, wheels, emission, fuel) values
       ($1, $2, 'BS6 Drum Self', 2020, null, 'drum', 'drum', 'self', 'alloy', 'bs6', 'fi'),
       ($3, $4, 'BS6 Disc', 2019, null, 'disc', 'drum', 'self', 'alloy', 'bs6', 'fi'),
       ($5, $6, 'Reborn', 2021, null, 'disc', 'disc', 'self', 'spoke', 'bs6', 'fi')`,
    [V.splendorDrum, M.splendor, V.pulsarDisc, M.pulsar, V.classic, M.classic],
  );
  await db.query(
    `insert into public.parts (id, sku, name, category, part_type, uom, standard_price_paise, is_universal) values
       ($1, 'T-SHOE', 'Front brake shoe', 'wear', 'front_brake_shoe', 'set', 25000, false),
       ($2, 'T-PAD', 'Front brake pad', 'wear', 'front_brake_pad', 'set', 45000, false),
       ($3, 'T-OIL', 'Engine oil 1L', 'consumable', 'engine_oil', 'bottle', 35000, true),
       ($4, 'T-OIL-RE', 'Engine oil 1L (RE)', 'model_specific', 'engine_oil', 'bottle', 52000, false),
       ($5, 'T-AIR', 'Air filter', 'consumable', 'air_filter', 'pcs', 18000, true),
       ($6, 'T-SHOE2', 'Front brake shoe (aftermarket)', 'wear', 'front_brake_shoe', 'set', 15000, false),
       ($7, 'T-SHOE3', 'Front brake shoe (unconfirmed)', 'wear', 'front_brake_shoe', 'set', 10000, false)`,
    [P.shoe, P.pad, P.oil, P.reOil, P.air, P.shoe2, P.shoe3],
  );
  await db.query(
    `insert into public.part_fitments (part_id, variant_id, qty_per_bike, source, confirmed_count) values
       ($1, $2, 1, 'catalogue', 0),
       ($3, $4, 1, 'catalogue', 0),
       ($5, $6, 3, 'catalogue', 0),
       ($7, $2, 1, 'learned', 2),
       ($8, $2, 1, 'learned', 0)`,
    [P.shoe, V.splendorDrum, P.pad, V.pulsarDisc, P.reOil, V.classic, P.shoe2, P.shoe3],
  );
  await db.query(
    `insert into public.finding_types (id, code, label_en, label_hi, area) values
       ($1, 'front_brake_worn', 'Front brake worn', 'आगे का ब्रेक घिसा', 'brakes'),
       ($2, 'engine_oil_due', 'Engine oil due', 'इंजन ऑयल बदलना है', 'engine'),
       ($3, 'engine_oil_topup', 'Engine oil low', 'इंजन ऑयल कम है', 'engine'),
       ($4, 'air_filter_dirty', 'Air filter dirty', 'एयर फ़िल्टर गंदा', 'engine'),
       ($5, 'chain_worn', 'Chain worn', 'चेन घिसी', 'drivetrain')`,
    [FT.brake, FT.oil, FT.topup, FT.air, FT.chain],
  );
  await db.query(
    `insert into public.finding_type_parts (finding_type_id, part_type, qty, attr_key, attr_value) values
       ($1, 'front_brake_shoe', 1, 'brake_front', 'drum')`,
    [FT.brake],
  );
  await db.query(
    `insert into public.finding_type_parts (finding_type_id, part_type, qty, attr_key, attr_value) values
       ($1, 'front_brake_pad', 1, 'brake_front', 'disc')`,
    [FT.brake],
  );
  await db.query(
    `insert into public.finding_type_parts (finding_type_id, part_type, qty, attr_key, attr_value) values
       ($1, 'engine_oil', 2, null, null),
       ($2, 'engine_oil', 1, null, null),
       ($3, 'air_filter', 1, 'segment', 'motorcycle'),
       ($4, 'chain_kit', 1, null, null)`,
    [FT.oil, FT.topup, FT.air, FT.chain],
  );
}

beforeAll(async () => {
  db = await pgClient();
  ncrManager = await clientAs("ncr_manager");
  ncrStore = await clientAs("ncr_store");
  jprManager = await clientAs("jpr_manager");
  admin = await clientAs("admin");
  noProfile = await clientAs("no_profile");
});

beforeEach(async () => {
  await testClear(db);
  await insertJobCardCatalog();
  await insertBins(db, "NCR");
  await insertBins(db, "JPR");
  await db.query(`insert into public.bins (id, workshop_id, code, kind) values ($1, $2, 'NCR-A01-02', 'normal')`, [
    BIN2,
    NCR,
  ]);
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

describe("suggestions (SPEC §9.1)", () => {
  it("picks the shoe for a drum variant and the pad for a disc variant", async () => {
    const drum = await createBike("DL3SAB0001", M.splendor, V.splendorDrum, [{ finding_type_id: FT.brake }]);
    const disc = await createBike("DL3SAB0002", M.pulsar, V.pulsarDisc, [{ finding_type_id: FT.brake }]);
    expect(drum).toMatchObject({ status: "draft", unresolved_findings: [] });
    expect(drum.code).toMatch(/^JC-NCR-\d{6}$/);
    expect(skus(drum)).toEqual(["T-SHOE"]);
    expect(lineOf(drum, "T-SHOE")).toMatchObject({ source: "suggested", qty_required: 1, qty_reserved: 0 });
    expect(skus(disc)).toEqual(["T-PAD"]);
    const bike = await one(`select status, purchased_at is not null as purchased from public.bikes where id = $1`, [
      drum.bike_id,
    ]);
    expect(bike).toEqual({ status: "purchased", purchased: true });
  });

  it("prefers a specific fitment over a universal part and applies qty precedence", async () => {
    // Mapping qty 2 (no fitment), qty_per_bike 3 (RE fitment), finding qty 1 wins over both.
    const universal = await createBike("DL3SAB0003", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    const specific = await createBike("DL3SAB0004", M.classic, V.classic, [{ finding_type_id: FT.oil }]);
    const explicit = await createBike("DL3SAB0005", M.classic, V.classic, [{ finding_type_id: FT.oil, qty: 1 }]);
    expect(universal.lines.map((l) => [l.sku, l.qty_required])).toEqual([["T-OIL", 2]]);
    expect(specific.lines.map((l) => [l.sku, l.qty_required])).toEqual([["T-OIL-RE", 3]]);
    expect(explicit.lines.map((l) => [l.sku, l.qty_required])).toEqual([["T-OIL-RE", 1]]);
  });

  it("merges two findings of one type into one line with the larger qty", async () => {
    const card = await createBike("DL3SAB0006", M.splendor, V.splendorDrum, [
      { finding_type_id: FT.oil, qty: 2 },
      { finding_type_id: FT.oil, qty: 4 },
    ]);
    expect(card.lines).toHaveLength(1);
    expect(lineOf(card, "T-OIL").qty_required).toBe(4);
    expect(lineOf(card, "T-OIL").finding_ids).toHaveLength(2);
  });

  it("sums findings of different types that resolve to the same part", async () => {
    const card = await createBike("DL3SAB0007", M.splendor, V.splendorDrum, [
      { finding_type_id: FT.oil },
      { finding_type_id: FT.topup },
    ]);
    expect(card.lines).toHaveLength(1);
    expect(lineOf(card, "T-OIL").qty_required).toBe(3);
    expect(lineOf(card, "T-OIL").finding_ids).toHaveLength(2);
  });

  it("does not auto-pick a flagged fitment (flagged > confirmed, and flagged = confirmed = 1)", async () => {
    for (const [flagged, confirmed, reg] of [
      [2, 1, "DL3SAB0008"],
      [1, 1, "DL3SAB0009"],
    ] as const) {
      await db.query(
        `update public.part_fitments set flagged_count = $3, confirmed_count = $4 where part_id = $1 and variant_id = $2`,
        [P.pad, V.pulsarDisc, flagged, confirmed],
      );
      const card = await createBike(reg, M.pulsar, V.pulsarDisc, [{ finding_type_id: FT.brake }]);
      expect(card.lines).toEqual([]);
      expect(card.unresolved_findings.map((f) => f.code)).toEqual(["front_brake_worn"]);

      const { data, error } = await ncrManager.rpc("finding_candidates", {
        p_finding_id: card.unresolved_findings[0].finding_id,
      });
      expect(error).toBeNull();
      expect(data!.map((c) => [c.sku, c.auto_pick])).toEqual([["T-PAD", false]]);
    }
  });

  it("leaves a finding with zero candidates unresolved", async () => {
    const card = await createBike("DL3SAB0010", M.splendor, V.splendorDrum, [
      { finding_type_id: FT.chain },
      { finding_type_id: FT.oil },
    ]);
    expect(skus(card)).toEqual(["T-OIL"]);
    expect(card.unresolved_findings.map((f) => f.code)).toEqual(["chain_worn"]);
  });

  it("uses only attr_key null or segment rows for an unknown variant", async () => {
    const card = await createBike("DL3SAB0011", M.splendor, null, [
      { finding_type_id: FT.oil },
      { finding_type_id: FT.air },
      { finding_type_id: FT.brake },
    ]);
    expect(skus(card)).toEqual(["T-AIR", "T-OIL"]);
    expect(card.unresolved_findings.map((f) => f.code)).toEqual(["front_brake_worn"]);
  });

  it("ranks candidates: catalogue first, unconfirmed learned excluded; RLS scopes the reads", async () => {
    const card = await createBike("DL3SAB0012", M.splendor, V.splendorDrum, [{ finding_type_id: FT.brake }]);
    const finding = lineOf(card, "T-SHOE").finding_ids[0];

    const fc = await ncrManager.rpc("finding_candidates", { p_finding_id: finding });
    expect(fc.error).toBeNull();
    expect(fc.data!.map((c) => [c.sku, c.rank, c.source, c.auto_pick, c.qty])).toEqual([
      ["T-SHOE", 1, "catalogue", true, 1],
      ["T-SHOE2", 2, "learned", true, 1],
    ]);

    const lc = await ncrManager.rpc("line_candidates", { p_line_id: lineOf(card, "T-SHOE").line_id });
    expect(lc.error).toBeNull();
    expect(lc.data!.map((c) => [c.sku, c.is_current])).toEqual([
      ["T-SHOE", true],
      ["T-SHOE2", false],
    ]);

    // Another workshop's bike is invisible to the invoker read.
    const other = await jprManager.rpc("finding_candidates", { p_finding_id: finding });
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);
  });
});

describe("confirm_job_card (SPEC §5.2)", () => {
  it("refuses with UNRESOLVED_FINDINGS, then confirms once every finding is resolved", async () => {
    const card = await createBike("DL3SAB0101", M.splendor, null, [
      { finding_type_id: FT.brake },
      { finding_type_id: FT.chain },
      { finding_type_id: FT.oil },
    ]);
    const res = await rpc(ncrManager, "confirm_job_card", { p_card_id: card.card_id });
    expectCode(res, "UNRESOLVED_FINDINGS");
    const ids = card.unresolved_findings.map((f) => f.finding_id);
    expect(detail(res).findings.map((f: { finding_id: string }) => f.finding_id).sort()).toEqual([...ids].sort());
    expect((await one(`select status from public.job_cards where id = $1`, [card.card_id])).status).toBe("draft");

    const brake = card.unresolved_findings.find((f) => f.code === "front_brake_worn")!.finding_id;
    const chain = card.unresolved_findings.find((f) => f.code === "chain_worn")!.finding_id;
    const afterPart = expectOk<Card>(
      await rpc(ncrManager, "resolve_finding", { p_finding_id: brake, p_part_id: P.shoe }),
    );
    expect(lineOf(afterPart, "T-SHOE")).toMatchObject({ source: "manual", qty_required: 1, finding_ids: [brake] });
    const afterReason = expectOk<Card>(
      await rpc(ncrManager, "resolve_finding", { p_finding_id: chain, p_no_part_reason: "Chain adjusted, not worn" }),
    );
    expect(afterReason.unresolved_findings).toEqual([]);
    expect(skus(afterReason)).toEqual(["T-OIL", "T-SHOE"]);

    const confirmed = await confirm(card.card_id);
    expect(confirmed.status).toBe("confirmed");
    const row = await one(
      `select confirmed_by, confirmed_at is not null as at from public.job_cards where id = $1`,
      [card.card_id],
    );
    expect(row).toEqual({ confirmed_by: manager, at: true });
  });

  it("validates resolve_finding: exactly one of part or reason", async () => {
    const card = await createBike("DL3SAB0102", M.splendor, null, [{ finding_type_id: FT.chain }]);
    const finding = card.unresolved_findings[0].finding_id;
    expectCode(await rpc(ncrManager, "resolve_finding", { p_finding_id: finding }), "VALIDATION");
    expectCode(await rpc(ncrManager, "resolve_finding", { p_finding_id: finding, p_no_part_reason: "  " }), "VALIDATION");
    expectCode(
      await rpc(ncrManager, "resolve_finding", { p_finding_id: finding, p_part_id: P.shoe, p_no_part_reason: "x" }),
      "VALIDATION",
    );
    expectCode(await rpc(ncrManager, "resolve_finding", { p_finding_id: finding, p_part_id: id(999) }), "NOT_FOUND");
  });

  it("defaults needed_by to the arrival date, or purchase date + 2 for a bike in transit", async () => {
    const inTransit = await createBike("DL3SAB0103", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    const arrived = await createBike("DL3SAB0104", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    expectOk(await rpc(ncrStore, "mark_arrived", { p_bike_id: arrived.bike_id }));

    const a = await confirm(inTransit.card_id);
    const b = await confirm(arrived.card_id);
    const expected = await one<{ transit: string; arrived: string }>(
      `select (select (private.ist_date(purchased_at) + 2)::text from public.bikes where id = $1) as transit,
              (select private.ist_date(arrived_at)::text from public.bikes where id = $2) as arrived`,
      [inTransit.bike_id, arrived.bike_id],
    );
    expect(a.needed_by).toBe(expected.transit);
    expect(b.needed_by).toBe(expected.arrived);
  });

  it("keeps a needed_by set before confirm", async () => {
    const card = await createBike("DL3SAB0105", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    expectOk(await rpc(ncrManager, "set_needed_by", { p_card_id: card.card_id, p_date: "2026-10-25" }));
    expect((await confirm(card.card_id)).needed_by).toBe("2026-10-25");
  });

  it("marks a card with zero lines complete at confirm", async () => {
    const empty = await createBike("DL3SAB0106", M.splendor, V.splendorDrum, []);
    expect(empty.lines).toEqual([]);
    const confirmed = await confirm(empty.card_id);
    expect(confirmed.parts_complete_at).not.toBeNull();
  });
});

describe("allocation at confirm (SPEC §6)", () => {
  it("reserves free stock, partially when short; a second confirm changes nothing", async () => {
    await stockIn(3);
    const a = await createBike("DL3SAB0201", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    const b = await createBike("DL3SAB0202", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);

    const ca = await confirm(a.card_id);
    expect(lineOf(ca, "T-OIL")).toMatchObject({ qty_required: 2, qty_reserved: 2, status: "reserved" });
    expect(ca.parts_complete_at).not.toBeNull();
    expect(ca.allocated).toEqual([expect.objectContaining({ card_code: a.code, qty: 2 })]);

    const cb = await confirm(b.card_id);
    expect(lineOf(cb, "T-OIL")).toMatchObject({ qty_required: 2, qty_reserved: 1, status: "partially_reserved" });
    expect(cb.parts_complete_at).toBeNull();

    const snapshot = async () =>
      (
        await db.query(
          `select (select jsonb_agg(c order by c.id) from public.job_cards c) as cards,
                  (select jsonb_agg(l order by l.id) from public.job_card_lines l) as lines`,
        )
      ).rows[0];
    const before = await snapshot();
    const again = await rpc(ncrManager, "confirm_job_card", { p_card_id: a.card_id });
    expectCode(again, "INVALID_TRANSITION");
    expect(detail(again)).toMatchObject({ reason: "not_draft", status: "confirmed" });
    expect(await snapshot()).toEqual(before);
  });

  it("allocates new stock FIFO by needed_by (set_needed_by changes future allocations only)", async () => {
    const first = await createBike("DL3SAB0203", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    const second = await createBike("DL3SAB0204", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    await confirm(first.card_id);
    await confirm(second.card_id);
    expectOk(await rpc(ncrManager, "set_needed_by", { p_card_id: first.card_id, p_date: "2026-11-30" }));
    expectOk(await rpc(ncrManager, "set_needed_by", { p_card_id: second.card_id, p_date: "2026-11-01" }));

    const res = expectOk<{ allocated: { card_code: string; qty: number }[] }>(
      await rpc(ncrManager, "adjust_stock", {
        p_bin_id: BIN2,
        p_part_id: P.oil,
        p_counted_qty: 3,
        p_expected_on_hand: 0,
        p_reason: "found",
      }),
    );
    expect(res.allocated.map((x) => [x.card_code, x.qty])).toEqual([
      [second.code, 2],
      [first.code, 1],
    ]);
    const complete = await one(`select parts_complete_at is not null as done from public.job_cards where id = $1`, [
      second.card_id,
    ]);
    expect(complete.done).toBe(true);

    // Moving needed_by never takes a reservation away.
    expectOk(await rpc(ncrManager, "set_needed_by", { p_card_id: first.card_id, p_date: "2026-10-21" }));
    const lines = await db.query(
      `select c.code, l.qty_reserved from public.job_card_lines l join public.job_cards c on c.id = l.job_card_id
       order by c.code`,
    );
    expect(lines.rows).toEqual([
      { code: first.code, qty_reserved: 1 },
      { code: second.code, qty_reserved: 2 },
    ]);
  });
});

describe("draft edits and findings lock", () => {
  it("update_draft_findings regenerates suggested lines and keeps manual ones", async () => {
    const card = await createBike("DL3SAB0301", M.splendor, V.splendorDrum, [
      { finding_type_id: FT.brake },
      { finding_type_id: FT.oil },
    ]);
    const switched = expectOk<Card>(
      await rpc(ncrManager, "switch_line_part", { p_line_id: lineOf(card, "T-SHOE").line_id, p_part_id: P.shoe2 }),
    );
    expect(lineOf(switched, "T-SHOE2")).toMatchObject({ source: "manual", line_id: lineOf(card, "T-SHOE").line_id });

    const updated = expectOk<Card>(
      await rpc(ncrManager, "update_draft_findings", {
        p_card_id: card.card_id,
        p_findings: [{ finding_type_id: FT.air }, { finding_type_id: FT.topup, qty: 2, notes: "Below min" }],
      }),
    );
    expect(updated.lines.map((l) => [l.sku, l.source, l.qty_required])).toEqual([
      ["T-AIR", "suggested", 1],
      ["T-OIL", "suggested", 2],
      ["T-SHOE2", "manual", 1],
    ]);
    const n = await one(`select count(*)::int as n from public.inspection_findings where bike_id = $1`, [card.bike_id]);
    expect(n.n).toBe(2);
  });

  it("switch_line_part onto a part already on the card merges the lines", async () => {
    const card = await createBike("DL3SAB0302", M.splendor, V.splendorDrum, [
      { finding_type_id: FT.brake },
      { finding_type_id: FT.oil },
    ]);
    const merged = expectOk<Card>(
      await rpc(ncrManager, "switch_line_part", { p_line_id: lineOf(card, "T-SHOE").line_id, p_part_id: P.oil }),
    );
    expect(merged.lines).toHaveLength(1);
    expect(lineOf(merged, "T-OIL")).toMatchObject({ source: "manual" });
    expect(lineOf(merged, "T-OIL").finding_ids).toHaveLength(2);
    const gone = await one(`select count(*)::int as n from public.job_card_lines where id = $1`, [
      lineOf(card, "T-SHOE").line_id,
    ]);
    expect(gone.n).toBe(0);
  });

  it("set_bike_variant regenerates suggestions and keeps manual lines", async () => {
    const card = await createBike("DL3SAB0303", M.splendor, null, [
      { finding_type_id: FT.brake },
      { finding_type_id: FT.chain },
    ]);
    const chain = card.unresolved_findings.find((f) => f.code === "chain_worn")!.finding_id;
    expectOk(await rpc(ncrManager, "resolve_finding", { p_finding_id: chain, p_part_id: P.air }));

    const res = expectOk<Card>(
      await rpc(ncrManager, "set_bike_variant", { p_bike_id: card.bike_id, p_variant_id: V.splendorDrum }),
    );
    expect(res.lines.map((l) => [l.sku, l.source])).toEqual([
      ["T-AIR", "manual"],
      ["T-SHOE", "suggested"],
    ]);
    expect(res.unresolved_findings).toEqual([]);

    expectCode(
      await rpc(ncrManager, "set_bike_variant", { p_bike_id: card.bike_id, p_variant_id: V.pulsarDisc }),
      "VALIDATION",
    );
  });

  it("locks findings and draft edits once the card is confirmed", async () => {
    const card = await createBike("DL3SAB0304", M.splendor, V.splendorDrum, [{ finding_type_id: FT.brake }]);
    await confirm(card.card_id);
    const finding = lineOf(card, "T-SHOE").finding_ids[0];

    expectCode(
      await rpc(ncrManager, "update_draft_findings", { p_card_id: card.card_id, p_findings: [] }),
      "FINDINGS_LOCKED",
    );
    expectCode(
      await rpc(ncrManager, "resolve_finding", { p_finding_id: finding, p_no_part_reason: "Not needed" }),
      "FINDINGS_LOCKED",
    );
    expectCode(
      await rpc(ncrManager, "switch_line_part", { p_line_id: lineOf(card, "T-SHOE").line_id, p_part_id: P.shoe2 }),
      "INVALID_TRANSITION",
    );
    expectCode(
      await rpc(ncrManager, "set_bike_variant", { p_bike_id: card.bike_id, p_variant_id: V.splendorDrum }),
      "INVALID_TRANSITION",
    );
    const lines = await db.query(`select part_id from public.job_card_lines where job_card_id = $1`, [card.card_id]);
    expect(lines.rows).toEqual([{ part_id: P.shoe }]);
  });
});

describe("bike transitions (SPEC §5.1)", () => {
  it("enforces purchased -> at_workshop -> in_repair and never overwrites timestamps", async () => {
    const card = await createBike("DL3SAB0401", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    const bike = card.bike_id;
    const times = () =>
      one<{ arrived_at: string | null; bay_in_at: string | null; status: string }>(
        `select status, arrived_at::text, bay_in_at::text from public.bikes where id = $1`,
        [bike],
      );

    expectCode(await rpc(ncrManager, "start_repair", { p_bike_id: bike }), "INVALID_TRANSITION");
    expectOk(await rpc(ncrStore, "mark_arrived", { p_bike_id: bike }));
    const arrived = await times();
    expect(arrived.status).toBe("at_workshop");
    expect(arrived.arrived_at).not.toBeNull();

    expectCode(await rpc(ncrStore, "mark_arrived", { p_bike_id: bike }), "INVALID_TRANSITION");
    const res = await rpc(ncrManager, "start_repair", { p_bike_id: bike });
    expectCode(res, "INVALID_TRANSITION");
    expect(detail(res).reason).toBe("no_confirmed_job_card");
    expect(await times()).toEqual(arrived);

    await confirm(card.card_id);
    expectCode(await rpc(ncrStore, "start_repair", { p_bike_id: bike }), "FORBIDDEN");
    expectOk(await rpc(ncrManager, "start_repair", { p_bike_id: bike }));
    const inRepair = await times();
    expect(inRepair.status).toBe("in_repair");
    expect(inRepair.arrived_at).toBe(arrived.arrived_at);
    expect(inRepair.bay_in_at).not.toBeNull();

    expectCode(await rpc(ncrManager, "start_repair", { p_bike_id: bike }), "INVALID_TRANSITION");
    expectCode(await rpc(ncrStore, "mark_arrived", { p_bike_id: bike }), "INVALID_TRANSITION");
    expect(await times()).toEqual(inRepair);
  });
});

describe("create_bike access, validation and idempotency", () => {
  const args = (reg: string, extra: Partial<Args<"create_bike">> = {}): Args<"create_bike"> => ({
    p_workshop_id: null,
    p_reg_no: reg,
    p_model_id: M.splendor,
    p_mfg_year: 2022,
    p_findings: [{ finding_type_id: FT.oil }],
    p_variant_id: V.splendorDrum,
    ...extra,
  });

  it("checks roles and workshops", async () => {
    expectCode(await rpc(ncrStore, "create_bike", args("DL3SAB0501")), "FORBIDDEN");
    expectCode(await rpc(noProfile, "create_bike", args("DL3SAB0501")), "NO_PROFILE");
    expectCode(await rpc(admin, "create_bike", args("DL3SAB0501")), "WORKSHOP_REQUIRED");
    expectCode(await rpc(jprManager, "create_bike", args("DL3SAB0501", { p_workshop_id: NCR })), "NOT_FOUND");

    const byAdmin = expectOk<Card>(await rpc(admin, "create_bike", args("DL3SAB0501", { p_workshop_id: NCR })));
    expect(byAdmin.code).toMatch(/^JC-NCR-/);
    expectCode(await rpc(jprManager, "confirm_job_card", { p_card_id: byAdmin.card_id }), "NOT_FOUND");
    expectCode(await rpc(ncrStore, "confirm_job_card", { p_card_id: byAdmin.card_id }), "FORBIDDEN");
  });

  it("returns the stored result for a retried request_id and writes one activity row", async () => {
    const requestId = uuidv4();
    const first = expectOk(await rpc(ncrManager, "create_bike", { ...args("DL3SAB0502"), p_request_id: requestId }));
    const second = expectOk(await rpc(ncrManager, "create_bike", { ...args("DL3SAB0502"), p_request_id: requestId }));
    expect(second).toEqual(first);
    expect((await one(`select count(*)::int as n from public.bikes`)).n).toBe(1);
    const log = await db.query(`select entity_type, action, user_id from public.activity_log where request_id = $1`, [
      requestId,
    ]);
    expect(log.rows).toEqual([{ entity_type: "bike", action: "create_bike", user_id: manager }]);
    expectCode(
      await rpc(ncrManager, "create_bike", { ...args("DL3SAB0599"), p_request_id: requestId }),
      "IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("issues sequential job card codes per workshop", async () => {
    const a = expectOk<Card>(await rpc(ncrManager, "create_bike", args("DL3SAB0503")));
    const b = expectOk<Card>(await rpc(ncrManager, "create_bike", args("DL3SAB0504")));
    const c = expectOk<Card>(
      await rpc(jprManager, "create_bike", args("RJ14AB0503", { p_findings: [] })),
    );
    expect([a.code, b.code, c.code]).toEqual(["JC-NCR-000001", "JC-NCR-000002", "JC-JPR-000001"]);
  });

  it("rejects bad input", async () => {
    expectCode(await rpc(ncrManager, "create_bike", args("  ")), "VALIDATION");
    expectCode(await rpc(ncrManager, "create_bike", args("--")), "VALIDATION");
    expectCode(await rpc(ncrManager, "create_bike", args("DL3SAB0505", { p_mfg_year: 1990 })), "MFG_YEAR_OUT_OF_RANGE");
    expectCode(await rpc(ncrManager, "create_bike", args("DL3SAB0505", { p_mfg_year: 2019 })), "MFG_YEAR_OUT_OF_RANGE");
    expectCode(
      await rpc(ncrManager, "create_bike", args("DL3SAB0505", { p_variant_id: V.pulsarDisc })),
      "VALIDATION",
    );
    expectCode(await rpc(ncrManager, "create_bike", args("DL3SAB0505", { p_model_id: id(998) })), "NOT_FOUND");
    expectCode(
      await rpc(ncrManager, "create_bike", args("DL3SAB0505", { p_findings: { finding_type_id: FT.oil } })),
      "VALIDATION",
    );
    expectCode(
      await rpc(ncrManager, "create_bike", args("DL3SAB0505", { p_findings: [{ finding_type_id: FT.oil, qty: 1.5 }] })),
      "VALIDATION",
    );
    expectCode(
      await rpc(ncrManager, "create_bike", args("DL3SAB0505", { p_findings: [{ finding_type_id: "nope" }] })),
      "VALIDATION",
    );
    expectCode(
      await rpc(ncrManager, "create_bike", args("DL3SAB0505", { p_findings: [{ finding_type_id: id(997) }] })),
      "NOT_FOUND",
    );
    expect((await one(`select count(*)::int as n from public.bikes`)).n).toBe(0);
  });

  it("rejects a reg no already used by an active bike (normalised, any workshop)", async () => {
    expectOk(await rpc(ncrManager, "create_bike", args("DL 3S AB 0506")));
    const dup = await rpc(ncrManager, "create_bike", args("dl3s-ab-0506"));
    expectCode(dup, "VALIDATION");
    expect(detail(dup).reason).toBe("duplicate_reg_no");
    expectCode(await rpc(jprManager, "create_bike", args("DL3SAB0506", { p_findings: [] })), "VALIDATION");
  });
});
