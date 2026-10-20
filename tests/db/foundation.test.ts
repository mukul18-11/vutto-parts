// Foundation helpers: errors, health, IST dates, idempotency, authorize and the role helpers.
import { readdirSync } from "node:fs";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { anonClient, pgClient } from "./clients";
import { expectInvariantsHold } from "./invariants";
import { DEMO_USERS, WORKSHOP_IDS } from "./demo-users";
import { NO_PROFILE_USER } from "./sessions";

const id = (key: string) => DEMO_USERS.find((u) => u.key === key)!.id;

let db: pg.Client;

beforeAll(async () => {
  db = await pgClient();
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

/** Runs fn in a transaction with auth.uid() = uid (null: no user); commits unless rollback. */
async function asUser<T>(
  uid: string | null,
  fn: () => Promise<T>,
  opts: { role?: "authenticated"; rollback?: boolean } = {},
): Promise<T> {
  await db.query("begin");
  try {
    if (uid) {
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role: "authenticated" }),
      ]);
    }
    if (opts.role) await db.query(`set local role ${opts.role}`);
    const result = await fn();
    await db.query(opts.rollback ? "rollback" : "commit");
    return result;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

async function one<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query(sql, params);
  return Object.values(rows[0])[0] as T;
}

async function pgError(p: Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await p;
  } catch (e) {
    return e as pg.DatabaseError;
  }
  throw new Error("expected the query to fail");
}

describe("private.err", () => {
  it("raises P0001 with the code as message and '{}' for a null detail", async () => {
    const e = await pgError(db.query("select private.err('FORBIDDEN', null)"));
    expect(e.code).toBe("P0001");
    expect(e.message).toBe("FORBIDDEN");
    expect(e.detail).toBe("{}");
  });

  it("passes a JSON detail through", async () => {
    const e = await pgError(db.query(`select private.err('VALIDATION', '{"field":"qty"}')`));
    expect(e.message).toBe("VALIDATION");
    expect(JSON.parse(e.detail!)).toEqual({ field: "qty" });
  });
});

describe("public.health", () => {
  it("is callable by anon and reports the newest migration version", async () => {
    const newest = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0])
      .sort()
      .at(-1);
    const { data, error } = await anonClient().rpc("health");
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true, schema_version: newest });
  });
});

describe("IST dates", () => {
  it("ist_date switches day at 18:30 UTC", async () => {
    expect(await one("select private.ist_date('2026-10-19T18:29:59Z')::text")).toBe("2026-10-19");
    expect(await one("select private.ist_date('2026-10-19T18:30:00Z')::text")).toBe("2026-10-20");
  });

  it("ist_today is today's IST date", async () => {
    expect(await one("select private.ist_today() = (now() at time zone 'Asia/Kolkata')::date")).toBe(true);
  });
});

describe("begin_request / finish_request", () => {
  const user = id("ncr_store");
  const begin = (fn: string, rid: string, payload: unknown) =>
    one("select private.begin_request($1, $2, $3::jsonb)", [fn, rid, JSON.stringify(payload)]);
  const finish = (fn: string, rid: string, result: unknown) =>
    one("select private.finish_request($1, $2, $3::jsonb)", [fn, rid, JSON.stringify(result)]);

  it("returns null for a new call and the stored result for an identical retry", async () => {
    const rid = uuidv4();
    await asUser(user, async () => {
      expect(await begin("test_fn", rid, { a: 1, b: 2 })).toBeNull();
      expect(await finish("test_fn", rid, { done: true })).toEqual({ done: true });
    });
    // Same payload with keys in another order: jsonb text is canonical.
    const replay = await asUser(user, () => begin("test_fn", rid, { b: 2, a: 1 }));
    expect(replay).toEqual({ done: true });
  });

  it("raises IDEMPOTENCY_KEY_REUSED for another payload or function", async () => {
    const rid = uuidv4();
    await asUser(user, async () => {
      await begin("test_fn", rid, { a: 1 });
      await finish("test_fn", rid, { ok: 1 });
    });
    const e1 = await pgError(asUser(user, () => begin("test_fn", rid, { a: 2 })));
    expect(e1.message).toBe("IDEMPOTENCY_KEY_REUSED");
    const e2 = await pgError(asUser(user, () => begin("other_fn", rid, { a: 1 })));
    expect(e2.message).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("stores nothing for a call that rolls back", async () => {
    const rid = uuidv4();
    await asUser(user, () => begin("test_fn", rid, {}), { rollback: true });
    expect(await asUser(user, () => begin("test_fn", rid, {}), { rollback: true })).toBeNull();
  });

  it("raises NOT_AUTHENTICATED without a user", async () => {
    const e = await pgError(asUser(null, () => begin("test_fn", uuidv4(), {})));
    expect(e.message).toBe("NOT_AUTHENTICATED");
  });
});

describe("private.authorize", () => {
  const authorize = (role: string, ws: string | null) =>
    db.query("select private.authorize($1::public.app_role, $2)", [role, ws]);

  it("passes a user in their own workshop at or above the role", async () => {
    await asUser(id("ncr_store"), () => authorize("store_keeper", WORKSHOP_IDS.NCR));
    await asUser(id("ncr_manager"), () => authorize("store_keeper", WORKSHOP_IDS.NCR));
  });

  it("passes admin for any workshop", async () => {
    await asUser(id("admin"), () => authorize("admin", WORKSHOP_IDS.JPR));
    await asUser(id("admin"), () => authorize("manager", null));
  });

  it.each([
    ["NOT_AUTHENTICATED", null, "store_keeper", WORKSHOP_IDS.NCR],
    ["NO_PROFILE", NO_PROFILE_USER.id, "store_keeper", WORKSHOP_IDS.NCR],
    ["FORBIDDEN", id("ncr_store"), "manager", WORKSHOP_IDS.NCR],
    ["FORBIDDEN", id("ncr_manager"), "admin", WORKSHOP_IDS.NCR],
    ["NOT_FOUND", id("ncr_store"), "store_keeper", WORKSHOP_IDS.JPR],
    ["NOT_FOUND", id("jpr_manager"), "manager", null],
  ])("raises %s", async (code, uid, role, ws) => {
    const e = await pgError(asUser(uid, () => authorize(role, ws)));
    expect(e.message).toBe(code);
  });
});

describe("role helpers as authenticated", () => {
  const helpers = () =>
    db.query(
      "select private.my_role()::text as role, private.my_workshop_id() as ws, private.is_admin() as admin",
    );

  it.each([
    ["ncr_manager", { role: "manager", ws: WORKSHOP_IDS.NCR, admin: false }],
    ["jpr_store", { role: "store_keeper", ws: WORKSHOP_IDS.JPR, admin: false }],
    ["admin", { role: "admin", ws: null, admin: true }],
  ])("%s", async (key, expected) => {
    const { rows } = await asUser(id(key), helpers, { role: "authenticated" });
    expect(rows[0]).toEqual(expected);
  });

  it("returns nulls and false for a user without a profile", async () => {
    const { rows } = await asUser(NO_PROFILE_USER.id, helpers, { role: "authenticated" });
    expect(rows[0]).toEqual({ role: null, ws: null, admin: false });
  });

  it("does not let authenticated execute other private functions", async () => {
    const e = await pgError(
      asUser(id("admin"), () => db.query("select private.authorize('store_keeper', null)"), {
        role: "authenticated",
      }),
    );
    expect(e.code).toBe("42501");
  });
});
