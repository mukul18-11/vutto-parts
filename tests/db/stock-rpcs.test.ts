// Stock RPCs (SPEC §8.4, §11.1) and search_parts (SPEC §14), acting as the demo users.
// No reservations exist here; the reservation cases are in Prompt 4 test 13.
import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/lib/database.types";
import { anonClient, clientAs, pgClient, type Client } from "./clients";
import { DEMO_USERS, WORKSHOP_IDS } from "./demo-users";
import { CAT, insertBins, insertCatalog, testClear, wsIds } from "./fixtures";
import { expectInvariantsHold } from "./invariants";

type Fns = Database["public"]["Functions"];
type Args<F extends keyof Fns> = Omit<Fns[F]["Args"], "p_request_id"> & { p_request_id?: string };
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const NCR = WORKSHOP_IDS.NCR;
const JPR = WORKSHOP_IDS.JPR;
const ncr = wsIds("NCR");
const jpr = wsIds("JPR");
const manager = DEMO_USERS.find((u) => u.key === "ncr_manager")!.id;
const n = (i: number) => `c1000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
const BIN2 = n(1); // NCR-A01-02, an empty normal bin
const CABLE = n(2); // OEM ABC-123-45
const STICKER = n(3); // name starts with ABC123

let db: pg.Client;
let ncrStore: Client;
let ncrManager: Client;
let jprStore: Client;
let noProfile: Client;

const rpc = <F extends keyof Fns>(c: Client, fn: F, args: Args<F>) =>
  c.rpc(fn, { p_request_id: uuidv4(), ...args } as never) as unknown as Promise<RpcResult>;

function expectCode(res: RpcResult, code: string) {
  expect(res.error?.message, JSON.stringify(res.error)).toBe(code);
}

function expectOk(res: RpcResult): Record<string, unknown> {
  expect(res.error, JSON.stringify(res.error)).toBeNull();
  return res.data as Record<string, unknown>;
}

async function onHand(bin: string, part: string = CAT.part): Promise<number | null> {
  const { rows } = await db.query(`select on_hand from public.stock_balances where bin_id = $1 and part_id = $2`, [
    bin,
    part,
  ]);
  return rows[0]?.on_hand ?? null;
}

async function moveCount(): Promise<number> {
  return Number((await db.query(`select count(*) as n from public.stock_moves`)).rows[0].n);
}

async function adjustInAsPostgres(ws: string, bin: string, qty: number) {
  await db.query(
    `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, reason, user_id)
     values ($1, $2, 'adjust_in', $3, $4, 'found', $5)`,
    [ws, CAT.part, qty, bin, manager],
  );
}

beforeAll(async () => {
  db = await pgClient();
  ncrStore = await clientAs("ncr_store");
  ncrManager = await clientAs("ncr_manager");
  jprStore = await clientAs("jpr_store");
  noProfile = await clientAs("no_profile");
});

/*
 * Fresh state per test. Engine oil (alias 'mobil'):
 *   NCR: RCV 5, A01-01 4, QRN 3, A01-02 empty (no balance row).  JPR: A01-01 2.
 */
beforeEach(async () => {
  await testClear(db);
  await insertCatalog(db);
  await db.query(`update public.parts set aliases = '{mobil}' where id = $1`, [CAT.part]);
  await db.query(
    `insert into public.parts (id, sku, name, oem_part_no, category, part_type, uom, standard_price_paise) values
       ($1, 'TEST-CABLE', 'Clutch cable', 'ABC-123-45', 'model_specific', 'clutch_cable', 'pcs', 15000),
       ($2, 'TEST-STK', 'ABC123 sticker kit', null, 'consumable', 'sticker', 'kit', 5000)`,
    [CABLE, STICKER],
  );
  await insertBins(db, "NCR");
  await insertBins(db, "JPR");
  await db.query(`insert into public.bins (id, workshop_id, code, kind) values ($1, $2, 'NCR-A01-02', 'normal')`, [
    BIN2,
    NCR,
  ]);
  await adjustInAsPostgres(NCR, ncr.rcv, 5);
  await adjustInAsPostgres(NCR, ncr.normal, 4);
  await adjustInAsPostgres(NCR, ncr.qrn, 3);
  await adjustInAsPostgres(JPR, jpr.normal, 2);
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

const putawayArgs = (qty: number, to: string = ncr.normal) => ({
  p_part_id: CAT.part,
  p_from_bin_id: ncr.rcv,
  p_to_bin_id: to,
  p_qty: qty,
});

describe("putaway", () => {
  it("moves part of the receiving stock and leaves the rest", async () => {
    const data = expectOk(await rpc(ncrStore, "putaway", putawayArgs(3)));
    expect(data).toMatchObject({ qty: 3, from_on_hand: 2, to_on_hand: 7 });
    expect(await onHand(ncr.rcv)).toBe(2);
    expect(await onHand(ncr.normal)).toBe(7);
    const { rows } = await db.query(`select move_type, user_id, request_id from public.stock_moves where id = $1`, [
      data.move_id,
    ]);
    expect(rows[0]).toMatchObject({ move_type: "putaway", user_id: DEMO_USERS.find((u) => u.key === "ncr_store")!.id });
    expect(rows[0].request_id).not.toBeNull();
  });

  it("refuses more than the bin holds", async () => {
    expectCode(await rpc(ncrStore, "putaway", putawayArgs(6)), "INSUFFICIENT_BIN_STOCK");
    expect(await onHand(ncr.rcv)).toBe(5);
  });

  it("refuses a quarantine or receiving destination", async () => {
    expectCode(await rpc(ncrStore, "putaway", putawayArgs(1, ncr.qrn)), "BIN_KIND_NOT_ALLOWED");
    expectCode(await rpc(ncrStore, "putaway", putawayArgs(1, ncr.rcv)), "BIN_KIND_NOT_ALLOWED");
  });

  it("treats another workshop's bin as not found", async () => {
    expectCode(await rpc(ncrStore, "putaway", putawayArgs(1, jpr.normal)), "NOT_FOUND");
    expect(await onHand(jpr.normal)).toBe(2);
  });
});

describe("idempotency", () => {
  it("returns the stored result for a repeated identical call and posts one move", async () => {
    const id = uuidv4();
    const before = await moveCount();
    const first = expectOk(await rpc(ncrStore, "putaway", { p_request_id: id, ...putawayArgs(2) }));
    const second = expectOk(await rpc(ncrStore, "putaway", { p_request_id: id, ...putawayArgs(2) }));
    expect(second).toEqual(first);
    expect(await moveCount()).toBe(before + 1);
    expect(await onHand(ncr.rcv)).toBe(3);
  });

  it("rejects the same request_id with a different payload", async () => {
    const id = uuidv4();
    expectOk(await rpc(ncrStore, "putaway", { p_request_id: id, ...putawayArgs(1) }));
    expectCode(await rpc(ncrStore, "putaway", { p_request_id: id, ...putawayArgs(2) }), "IDEMPOTENCY_KEY_REUSED");
    expect(await onHand(ncr.rcv)).toBe(4);
  });

  it("stores nothing for a failed call, so it can be retried", async () => {
    const id = uuidv4();
    expectCode(await rpc(ncrStore, "putaway", { p_request_id: id, ...putawayArgs(6) }), "INSUFFICIENT_BIN_STOCK");
    const { rows } = await db.query(`select 1 from public.idempotency where request_id = $1`, [id]);
    expect(rows).toEqual([]);

    await adjustInAsPostgres(NCR, ncr.rcv, 1);
    const data = expectOk(await rpc(ncrStore, "putaway", { p_request_id: id, ...putawayArgs(6) }));
    expect(data).toMatchObject({ from_on_hand: 0, to_on_hand: 10 });
  });
});

describe("adjust_stock", () => {
  const adjust = (bin: string, counted: number, expected: number) =>
    rpc(ncrManager, "adjust_stock", {
      p_bin_id: bin,
      p_part_id: CAT.part,
      p_counted_qty: counted,
      p_expected_on_hand: expected,
      p_reason: "count_correction",
    });

  it("raises STALE_COUNT when the bin changed since the count screen loaded, posting nothing", async () => {
    const before = await moveCount();
    expectCode(await adjust(ncr.normal, 2, 3), "STALE_COUNT");
    expect(await moveCount()).toBe(before);
    expect(await onHand(ncr.normal)).toBe(4);
  });

  it("posts no move when the count matches and clears the count request", async () => {
    expectOk(await rpc(ncrStore, "request_bin_count", { p_bin_id: ncr.normal }));
    const requested = await db.query(`select count_requested_at from public.bins where id = $1`, [ncr.normal]);
    expect(requested.rows[0].count_requested_at).not.toBeNull();

    const before = await moveCount();
    const data = expectOk(await adjust(ncr.normal, 4, 4));
    expect(data).toMatchObject({ move_id: null, delta: 0, on_hand: 4 });
    expect(await moveCount()).toBe(before);
    const cleared = await db.query(`select count_requested_at from public.bins where id = $1`, [ncr.normal]);
    expect(cleared.rows[0].count_requested_at).toBeNull();
  });

  it("creates the balance row for adjust_in into a bin that never held the part", async () => {
    expect(await onHand(BIN2)).toBeNull();
    expect(expectOk(await adjust(BIN2, 4, 0))).toMatchObject({ delta: 4, on_hand: 4 });
    expect(await onHand(BIN2)).toBe(4);
  });

  it("allows adjust_in into the quarantine bin", async () => {
    const data = expectOk(await adjust(ncr.qrn, 5, 3));
    expect(data).toMatchObject({ delta: 2, on_hand: 5 });
    const { rows } = await db.query(`select move_type from public.stock_moves where id = $1`, [data.move_id]);
    expect(rows[0].move_type).toBe("adjust_in");
  });

  it("posts adjust_out when the count is lower", async () => {
    expect(expectOk(await adjust(ncr.normal, 1, 4))).toMatchObject({ delta: -3, on_hand: 1, released: [] });
  });
});

describe("quarantine and return to supplier", () => {
  const move = (c: Client, from: string, to: string, reason: string | null) =>
    rpc(c, "move_stock", {
      p_part_id: CAT.part,
      p_from_bin_id: from,
      p_to_bin_id: to,
      p_qty: 1,
      p_reason: reason as string,
    });

  it("requires a reason to move into quarantine", async () => {
    expectCode(await move(ncrStore, ncr.normal, ncr.qrn, null), "VALIDATION");
    expectCode(await move(ncrStore, ncr.normal, ncr.qrn, "  "), "VALIDATION");
    expect(expectOk(await move(ncrStore, ncr.normal, ncr.qrn, "cracked"))).toMatchObject({
      from_on_hand: 3,
      to_on_hand: 4,
      released: [],
    });
  });

  it("lets only a manager move stock out of quarantine", async () => {
    expectCode(await move(ncrStore, ncr.qrn, ncr.normal, "checked ok"), "FORBIDDEN");
    expect(expectOk(await move(ncrManager, ncr.qrn, ncr.normal, "checked ok"))).toMatchObject({
      from_on_hand: 2,
      to_on_hand: 5,
      allocated: [],
    });
  });

  it("returns to the supplier only from the quarantine bin", async () => {
    const rts = (bin: string) =>
      rpc(ncrManager, "return_to_supplier", { p_bin_id: bin, p_part_id: CAT.part, p_qty: 2, p_reason: "damaged" });
    expectCode(await rts(ncr.normal), "BIN_KIND_NOT_ALLOWED");
    expect(expectOk(await rts(ncr.qrn))).toMatchObject({ on_hand: 1 });
  });
});

describe("authorization", () => {
  it("treats another workshop's bin as not found", async () => {
    expectCode(await rpc(jprStore, "putaway", putawayArgs(1)), "NOT_FOUND");
  });

  it("forbids a store keeper from adjusting stock", async () => {
    expectCode(
      await rpc(ncrStore, "adjust_stock", {
        p_bin_id: ncr.normal,
        p_part_id: CAT.part,
        p_counted_qty: 4,
        p_expected_on_hand: 4,
        p_reason: "count_correction",
      }),
      "FORBIDDEN",
    );
  });

  it("denies anon", async () => {
    const res = await rpc(anonClient(), "putaway", putawayArgs(1));
    expect(res.error?.code, JSON.stringify(res.error)).toBe("42501");
    expect(res.error?.message).toMatch(/permission denied/);
  });

  it("refuses a user with no profile", async () => {
    expectCode(await rpc(noProfile, "putaway", putawayArgs(1)), "NO_PROFILE");
  });
});

describe("search_parts", () => {
  type Row = Fns["search_parts"]["Returns"][number];
  const search = async (c: Client, q: string, ws: string) => {
    const { data, error } = await c.rpc("search_parts", { p_q: q, p_workshop_id: ws });
    expect(error, JSON.stringify(error)).toBeNull();
    return data as Row[];
  };

  it("finds engine oil by its alias", async () => {
    const rows = await search(jprStore, "mobil", JPR);
    expect(rows.map((r) => r.part_id)).toContain(CAT.part);
  });

  it("ranks an OEM prefix match first", async () => {
    const rows = await search(ncrStore, "ABC123", NCR);
    expect(rows.map((r) => r.part_id)).toEqual([CABLE, STICKER]);
  });

  it("shows only the caller's workshop availability", async () => {
    const jprRow = (await search(jprStore, "engine oil", JPR)).find((r) => r.part_id === CAT.part);
    expect(jprRow).toMatchObject({ usable_on_hand: 2, available: 2 });
    const peek = (await search(jprStore, "engine oil", NCR)).find((r) => r.part_id === CAT.part);
    expect(peek).toMatchObject({ usable_on_hand: null, available: null });
    // NCR: RCV 5 + A01-01 4; quarantine never counts.
    const ncrRow = (await search(ncrStore, "engine oil", NCR)).find((r) => r.part_id === CAT.part);
    expect(ncrRow).toMatchObject({ usable_on_hand: 9, available: 9 });
  });

  it("needs at least 2 characters", async () => {
    expect(await search(ncrStore, " m ", NCR)).toEqual([]);
  });
});

describe("next_code", () => {
  it("formats and increments per workshop and type", async () => {
    const next = async (ws: string, type: string) =>
      (await db.query(`select private.next_code($1, $2::public.doc_type) as code`, [ws, type])).rows[0].code;
    expect(await next(NCR, "po")).toBe("PO-NCR-000001");
    expect(await next(NCR, "po")).toBe("PO-NCR-000002");
    expect(await next(JPR, "job_card")).toBe("JC-JPR-000001");
    expect(await next(NCR, "grn")).toBe("GRN-NCR-000001");
  });
});
