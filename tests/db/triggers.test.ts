// Table triggers and constraints (SPEC §3, §5.1). Cases run as postgres inside a transaction that
// is rolled back after each test; the admin cases go through PostgREST.
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clientAs, pgClient, type Client } from "./clients";
import { WORKSHOP_IDS } from "./demo-users";
import { CAT, insertBins, insertCatalog, insertWorkshopChain, testClear, wsIds } from "./fixtures";
import { expectInvariantsHold } from "./invariants";

const NCR = WORKSHOP_IDS.NCR;
const ncr = wsIds("NCR");
const jpr = wsIds("JPR");
const EMPTY_BIN = "c1000000-0000-0000-0000-000000000001";
const PART2 = "c1000000-0000-0000-0000-000000000002";
const OTHER_MODEL = "c1000000-0000-0000-0000-000000000003";
const OTHER_VARIANT = "c1000000-0000-0000-0000-000000000004";

let db: pg.Client;
let admin: Client;
let regSeq = 0;
const nextReg = () => `HR26X${String(++regSeq).padStart(4, "0")}`;

beforeAll(async () => {
  db = await pgClient();
  await testClear(db);
  await insertCatalog(db);
  await insertWorkshopChain(db, "NCR");
  await insertBins(db, "JPR");
  await db.query(`insert into public.bins (id, workshop_id, code, kind) values ($1, $2, 'NCR-A01-02', 'normal')`, [
    EMPTY_BIN,
    NCR,
  ]);
  await db.query(
    `insert into public.parts (id, sku, name, category, part_type, uom, standard_price_paise)
     values ($1, 'TEST-PAD', 'Brake pad', 'wear', 'front_brake_pad', 'set', 50000)`,
    [PART2],
  );
  await db.query(`insert into public.vehicle_models (id, make, model, segment) values ($1, 'Honda', 'Activa', 'scooter')`, [
    OTHER_MODEL,
  ]);
  await db.query(
    `insert into public.model_variants
       (id, model_id, name, year_from, year_to, brake_front, brake_rear, start_type, wheels, emission, fuel)
     values ($1, $2, '6G', 2016, 2019, 'drum', 'drum', 'self', 'steel', 'bs4', 'carb')`,
    [OTHER_VARIANT, OTHER_MODEL],
  );
  admin = await clientAs("admin");
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

/** Runs one statement in a savepoint and returns its error (or null). */
async function attempt(sql: string, params: readonly unknown[] = []): Promise<pg.DatabaseError | null> {
  await db.query("savepoint t");
  try {
    await db.query(sql, [...params]);
    await db.query("release savepoint t");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint t");
    return e as pg.DatabaseError;
  }
}

async function expectRaise(code: string, sql: string, params: readonly unknown[] = []) {
  const e = await attempt(sql, params);
  expect(e, `expected ${code} from: ${sql}`).not.toBeNull();
  if (/^[0-9A-Z]{5}$/.test(code) && !/_/.test(code)) {
    expect(e!.code).toBe(code);
  } else {
    expect(e!.code).toBe("P0001");
    expect(e!.message).toBe(code);
  }
}

async function expectOk(sql: string, params: readonly unknown[] = []) {
  const e = await attempt(sql, params);
  expect(e?.message ?? null, sql).toBeNull();
}

async function newBike(opts: { status?: string; arrived?: boolean; reg?: string; model?: string; variant?: string | null; year?: number } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.bikes (workshop_id, reg_no, model_id, variant_id, mfg_year, status, purchased_at, arrived_at)
     values ($1, $2, $3, $4, $5, $6, now() - interval '1 day', case when $7 then now() - interval '1 hour' end)
     returning id`,
    [
      NCR,
      opts.reg ?? nextReg(),
      opts.model ?? CAT.model,
      opts.variant === undefined ? CAT.variant : opts.variant,
      opts.year ?? 2021,
      opts.status ?? "purchased",
      opts.arrived ?? false,
    ],
  );
  return rows[0].id;
}

const move = (fields: Record<string, unknown>) => {
  const row = { workshop_id: NCR, part_id: CAT.part, qty: 1, ...fields };
  const cols = Object.keys(row);
  return [
    `insert into public.stock_moves (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row),
  ] as const;
};

const onHand = async (bin: string, part = CAT.part) =>
  (await db.query(`select on_hand from public.stock_balances where bin_id = $1 and part_id = $2`, [bin, part])).rows[0]
    ?.on_hand as number | undefined;

describe("as postgres (rolled back)", () => {
  beforeEach(async () => {
    await db.query("begin");
  });
  afterEach(async () => {
    await db.query("rollback");
  });

  describe("bikes", () => {
    it("raises INVALID_TRANSITION for a status change outside SPEC §5.1", async () => {
      await expectRaise("INVALID_TRANSITION", `update public.bikes set status = 'ready', ready_at = now() where id = $1`, [ncr.bike]);
      const purchased = await newBike();
      await expectRaise("INVALID_TRANSITION", `update public.bikes set status = 'in_repair' where id = $1`, [purchased]);
      await expectOk(`update public.bikes set status = 'cancelled', cancelled_at = now() where id = $1`, [purchased]);
      await expectRaise("INVALID_TRANSITION", `update public.bikes set status = 'purchased' where id = $1`, [purchased]);
    });

    it("allows purchased -> at_workshop only with arrived_at", async () => {
      const bike = await newBike();
      await expectRaise("23514", `update public.bikes set status = 'at_workshop' where id = $1`, [bike]);
      await expectOk(`update public.bikes set status = 'at_workshop', arrived_at = now() where id = $1`, [bike]);
    });

    it("requires a confirmed job card for at_workshop -> in_repair", async () => {
      const bike = await newBike({ status: "at_workshop", arrived: true });
      await expectRaise("INVALID_TRANSITION", `update public.bikes set status = 'in_repair', bay_in_at = now() where id = $1`, [bike]);
      await expectOk(`update public.bikes set status = 'in_repair', bay_in_at = now() where id = $1`, [ncr.bike]);
    });

    it("never overwrites a set timestamp and sets timestamps only in their transition", async () => {
      await expectRaise("INVALID_TRANSITION", `update public.bikes set arrived_at = now() where id = $1`, [ncr.bike]);
      await expectRaise("INVALID_TRANSITION", `update public.bikes set purchased_at = now() - interval '9 days' where id = $1`, [ncr.bike]);
      const bike = await newBike();
      await expectRaise("INVALID_TRANSITION", `update public.bikes set arrived_at = now() where id = $1`, [bike]);
    });

    it("keeps workshop_id fixed", async () => {
      await expectRaise("VALIDATION", `update public.bikes set workshop_id = $2 where id = $1`, [ncr.bike, WORKSHOP_IDS.JPR]);
    });

    it("raises MFG_YEAR_OUT_OF_RANGE outside the variant's years or 1995..IST year", async () => {
      await expectRaise("MFG_YEAR_OUT_OF_RANGE", ...insertBikeSql({ year: 2019 })); // variant from 2020
      await expectRaise("MFG_YEAR_OUT_OF_RANGE", ...insertBikeSql({ year: 2020, model: OTHER_MODEL, variant: OTHER_VARIANT })); // to 2019
      await expectRaise("MFG_YEAR_OUT_OF_RANGE", ...insertBikeSql({ year: 1994, variant: null }));
      const { rows } = await db.query(`select extract(year from private.ist_today())::int + 1 as y`);
      await expectRaise("MFG_YEAR_OUT_OF_RANGE", ...insertBikeSql({ year: rows[0].y, variant: null }));
      await expectRaise("MFG_YEAR_OUT_OF_RANGE", `update public.bikes set mfg_year = 2019 where id = $1`, [ncr.bike]);
      await expectOk(...insertBikeSql({ year: 1995, variant: null }));
      await expectOk(...insertBikeSql({ year: 2016, model: OTHER_MODEL, variant: OTHER_VARIANT }));
    });

    it("rejects a variant of another model", async () => {
      await expectRaise("VALIDATION", ...insertBikeSql({ year: 2021, variant: OTHER_VARIANT }));
    });

    it("keeps reg_no_norm unique among bikes that are not cancelled", async () => {
      await expectRaise("23505", ...insertBikeSql({ year: 2021, reg: "dl-3s-ab-0001" }));
      await db.query(`update public.bikes set status = 'cancelled', cancelled_at = now() where reg_no_norm = 'DL3SAB0001'`);
      await expectOk(...insertBikeSql({ year: 2021, reg: "dl-3s-ab-0001" }));
    });
  });

  describe("inspection findings", () => {
    it("are locked while the bike has a confirmed card", async () => {
      await expectRaise("FINDINGS_LOCKED", `update public.inspection_findings set notes = 'x' where id = $1`, [ncr.finding]);
      await expectRaise("FINDINGS_LOCKED", `delete from public.inspection_findings where id = $1`, [ncr.finding]);
      await expectRaise(
        "FINDINGS_LOCKED",
        `insert into public.inspection_findings (workshop_id, bike_id, finding_type_id) values ($1, $2, $3)`,
        [NCR, ncr.bike, CAT.findingType],
      );
    });

    it("unlock when the card is cancelled", async () => {
      await db.query(`update public.job_card_lines set qty_reserved = 0, cancelled_at = now() where id = $1`, [ncr.line]);
      await db.query(
        `update public.job_cards set status = 'cancelled', cancelled_at = now(), parts_complete_at = null where id = $1`,
        [ncr.card],
      );
      await expectOk(`update public.inspection_findings set notes = 'x' where id = $1`, [ncr.finding]);
    });

    it("link only to a line on the same bike", async () => {
      const bike = await newBike();
      await expectRaise(
        "VALIDATION",
        `insert into public.inspection_findings (workshop_id, bike_id, finding_type_id, job_card_line_id) values ($1, $2, $3, $4)`,
        [NCR, bike, CAT.findingType, ncr.line],
      );
    });
  });

  describe("job cards and lines", () => {
    it("fix part_id once the card is confirmed", async () => {
      await expectRaise("VALIDATION", `update public.job_card_lines set part_id = $2 where id = $1`, [ncr.line, PART2]);
    });

    it("allow reservations only on confirmed cards", async () => {
      const bike = await newBike({ reg: "DL9ZZ9999" });
      await db.query(
        `insert into public.job_cards (id, workshop_id, code, bike_id) values ('c1000000-0000-0000-0000-000000000010', $1, 'JC-NCR-000099', $2)`,
        [NCR, bike],
      );
      await expectRaise(
        "VALIDATION",
        `insert into public.job_card_lines (workshop_id, job_card_id, part_id, qty_required, qty_reserved, source)
         values ($1, 'c1000000-0000-0000-0000-000000000010', $2, 2, 1, 'suggested')`,
        [NCR, CAT.part],
      );
      await expectRaise(
        "VALIDATION",
        `update public.job_cards set status = 'cancelled', cancelled_at = now(), parts_complete_at = null where id = $1`,
        [ncr.card],
      );
    });

    it("let a draft card switch a line's part", async () => {
      const bike = await newBike({ reg: "DL9ZZ9998" });
      await db.query(
        `insert into public.job_cards (id, workshop_id, code, bike_id) values ('c1000000-0000-0000-0000-000000000011', $1, 'JC-NCR-000098', $2)`,
        [NCR, bike],
      );
      const { rows } = await db.query(
        `insert into public.job_card_lines (workshop_id, job_card_id, part_id, qty_required, source)
         values ($1, 'c1000000-0000-0000-0000-000000000011', $2, 1, 'suggested') returning id`,
        [NCR, CAT.part],
      );
      await expectOk(`update public.job_card_lines set part_id = $2, source = 'manual' where id = $1`, [rows[0].id, PART2]);
    });

    it("compute line status from base columns", async () => {
      const status = async () =>
        (await db.query(`select status from public.job_card_lines where id = $1`, [ncr.line])).rows[0].status;
      expect(await status()).toBe("reserved");
      await db.query(`update public.job_card_lines set qty_reserved = 1 where id = $1`, [ncr.line]);
      expect(await status()).toBe("partially_reserved");
      await db.query(`update public.job_card_lines set qty_reserved = 0 where id = $1`, [ncr.line]);
      expect(await status()).toBe("needed");
      await db.query(`update public.job_card_lines set qty_issued = 2 where id = $1`, [ncr.line]);
      expect(await status()).toBe("issued");
      await db.query(`update public.job_card_lines set qty_required = 0, qty_issued = 0, cancelled_at = now() where id = $1`, [ncr.line]);
      expect(await status()).toBe("cancelled");
      await expectRaise("23514", `update public.job_card_lines set qty_reserved = 1 where id = $1`, [ncr.line]);
    });
  });

  describe("stock moves", () => {
    it("reject an issue into a bin", async () => {
      await expectRaise("BIN_KIND_NOT_ALLOWED", ...move({ move_type: "issue", to_bin_id: ncr.normal, job_card_line_id: ncr.line }));
    });

    it("reject a putaway into quarantine", async () => {
      await expectRaise("BIN_KIND_NOT_ALLOWED", ...move({ move_type: "putaway", from_bin_id: ncr.rcv, to_bin_id: ncr.qrn }));
    });

    it("enforce the other bin kinds of SPEC §3.4", async () => {
      await expectRaise("BIN_KIND_NOT_ALLOWED", ...move({ move_type: "grn", to_bin_id: ncr.normal, grn_line_id: ncr.grnLine }));
      await expectRaise("BIN_KIND_NOT_ALLOWED", ...move({ move_type: "move", from_bin_id: ncr.qrn, to_bin_id: ncr.rcv, reason: "x" }));
      await expectRaise("BIN_KIND_NOT_ALLOWED", ...move({ move_type: "return_to_supplier", from_bin_id: ncr.normal, reason: "x" }));
      await expectRaise("BIN_KIND_NOT_ALLOWED", ...move({ move_type: "emergency_in", to_bin_id: ncr.normal, emergency_buy_id: ncr.buy }));
      await expectOk(...move({ move_type: "move", from_bin_id: ncr.rcv, to_bin_id: ncr.normal }));
    });

    it("require reasons and links", async () => {
      await expectRaise("VALIDATION", ...move({ move_type: "move", from_bin_id: ncr.normal, to_bin_id: ncr.qrn }));
      await expectRaise("VALIDATION", ...move({ move_type: "adjust_out", from_bin_id: ncr.normal, reason: "  " }));
      await expectRaise("VALIDATION", ...move({ move_type: "issue", from_bin_id: ncr.normal }));
      await expectRaise("VALIDATION", ...move({ move_type: "grn", to_bin_id: ncr.rcv }));
    });

    it("reject a part that differs from the linked line", async () => {
      await db.query(...move({ move_type: "adjust_in", to_bin_id: ncr.normal, part_id: PART2, reason: "found" }));
      await expectRaise("VALIDATION", ...move({ move_type: "issue", from_bin_id: ncr.normal, part_id: PART2, job_card_line_id: ncr.line }));
    });

    it("reject bins of another workshop and inactive bins", async () => {
      await expectRaise("NOT_FOUND", ...move({ move_type: "adjust_in", to_bin_id: jpr.normal, reason: "found" }));
      await db.query(`update public.bins set is_active = false where id = $1`, [EMPTY_BIN]);
      await expectRaise("VALIDATION", ...move({ move_type: "adjust_in", to_bin_id: EMPTY_BIN, reason: "found" }));
    });

    it("reject from = to", async () => {
      await expectRaise("23514", ...move({ move_type: "move", from_bin_id: ncr.normal, to_bin_id: ncr.normal }));
    });

    it("never let on_hand go negative", async () => {
      expect(await onHand(ncr.normal)).toBe(3);
      await expectRaise("INSUFFICIENT_BIN_STOCK", ...move({ move_type: "adjust_out", from_bin_id: ncr.normal, qty: 4, reason: "lost" }));
      await expectRaise("INSUFFICIENT_BIN_STOCK", ...move({ move_type: "adjust_out", from_bin_id: EMPTY_BIN, reason: "lost" }));
      await expectRaise("23514", `update public.stock_balances set on_hand = -1 where bin_id = $1`, [ncr.normal]);
      expect(await onHand(ncr.normal)).toBe(3);
    });

    it("maintain stock_balances and keep rows that reach 0", async () => {
      await db.query(...move({ move_type: "move", from_bin_id: ncr.normal, to_bin_id: EMPTY_BIN, qty: 3 }));
      expect(await onHand(ncr.normal)).toBe(0);
      expect(await onHand(EMPTY_BIN)).toBe(3);
      await db.query(...move({ move_type: "move", from_bin_id: EMPTY_BIN, to_bin_id: ncr.normal, qty: 1 }));
      expect(await onHand(ncr.normal)).toBe(1);
      expect(await onHand(EMPTY_BIN)).toBe(2);
    });
  });

  describe("finding_type_parts", () => {
    const FT = "c1000000-0000-0000-0000-000000000020";
    const add = (key: string | null, value: string | null) =>
      [
        `insert into public.finding_type_parts (finding_type_id, part_type, qty, attr_key, attr_value) values ($1, 'brake', 1, $2, $3)`,
        [FT, key, value],
      ] as const;

    beforeEach(async () => {
      await db.query(
        `insert into public.finding_types (id, code, label_en, label_hi, area) values ($1, 'front_brake_worn', 'Front brake worn', 'आगे का ब्रेक', 'brakes')`,
        [FT],
      );
    });

    it("allow one attr_key with distinct values", async () => {
      await expectOk(...add("brake_front", "drum"));
      await expectOk(...add("brake_front", "disc"));
    });

    it("reject a finding type that could resolve to two parts", async () => {
      await expectOk(...add(null, null));
      await expectRaise("VALIDATION", ...add(null, null));
      await expectRaise("VALIDATION", ...add("brake_front", "drum"));
    });

    it("reject repeated values, mixed keys and unknown values", async () => {
      await expectOk(...add("brake_front", "drum"));
      await expectRaise("VALIDATION", ...add("brake_front", "drum"));
      await expectRaise("VALIDATION", ...add("brake_rear", "disc"));
      await expectRaise("VALIDATION", ...add("brake_front", "drums"));
    });
  });

  describe("bins", () => {
    it("must match their workshop and kind", async () => {
      await expectRaise("VALIDATION", `insert into public.bins (workshop_id, code, kind) values ($1, 'JPR-A09-01', 'normal')`, [NCR]);
      await expectRaise("VALIDATION", `insert into public.bins (workshop_id, code, kind) values ($1, 'NCR-A09-01', 'quarantine')`, [NCR]);
      await expectRaise("23514", `insert into public.bins (workshop_id, code, kind) values ($1, 'NCR-A9-1', 'normal')`, [NCR]);
    });
  });

  describe("append-only", () => {
    it("blocks UPDATE and DELETE on stock_moves even as postgres", async () => {
      await expectRaise("VALIDATION", `update public.stock_moves set qty = qty`);
      await expectRaise("VALIDATION", `delete from public.stock_moves`);
    });
  });
});

describe("bins edited by admin through PostgREST", () => {
  it("raise VALIDATION when kind or code changes", async () => {
    const kind = await admin.from("bins").update({ kind: "quarantine" }).eq("id", EMPTY_BIN);
    expect(kind.error?.code).toBe("P0001");
    expect(kind.error?.message).toBe("VALIDATION");
    const code = await admin.from("bins").update({ code: "NCR-A01-09" }).eq("id", EMPTY_BIN);
    expect(code.error?.message).toBe("VALIDATION");
  });

  it("raise VALIDATION when deactivating a bin that holds stock", async () => {
    const res = await admin.from("bins").update({ is_active: false }).eq("id", ncr.normal);
    expect(res.error?.message).toBe("VALIDATION");
    const { rows } = await db.query(`select is_active from public.bins where id = $1`, [ncr.normal]);
    expect(rows[0].is_active).toBe(true);
  });

  it("deactivate an empty bin and allow count requests", async () => {
    const res = await admin.from("bins").update({ is_active: false, count_requested_at: new Date().toISOString() }).eq("id", EMPTY_BIN).select("is_active");
    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ is_active: false }]);
  });
});

function insertBikeSql(opts: { year: number; reg?: string; model?: string; variant?: string | null }) {
  return [
    `insert into public.bikes (workshop_id, reg_no, model_id, variant_id, mfg_year, purchased_at) values ($1, $2, $3, $4, $5, now())`,
    [NCR, opts.reg ?? nextReg(), opts.model ?? CAT.model, opts.variant === undefined ? CAT.variant : opts.variant, opts.year],
  ] as const;
}
