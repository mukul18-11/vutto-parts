// Row Level Security and table privileges through PostgREST (SPEC §11.2, §11.3).
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, clientAs, pgClient, type Client } from "./clients";
import { DEMO_USERS, WORKSHOP_IDS, type DemoUserKey } from "./demo-users";
import { CAT, insertCatalog, insertGlobalRows, insertWorkshopChain, testClear, wsIds } from "./fixtures";
import { NO_PROFILE_USER, type SessionKey } from "./sessions";

// Tables with a workshop_id and the workshop-scoped SELECT policy. profiles and doc_counters
// also have a workshop_id but their own rules (checked below).
const WORKSHOP_TABLES = [
  "activity_log",
  "bikes",
  "bins",
  "emergency_buys",
  "grn_lines",
  "grns",
  "inspection_findings",
  "job_card_lines",
  "job_cards",
  "po_lines",
  "purchase_orders",
  "reorder_settings",
  "stock_balances",
  "stock_moves",
];
const MASTER_TABLES = [
  "finding_type_parts",
  "finding_types",
  "model_variants",
  "part_fitments",
  "parts",
  "supplier_parts",
  "suppliers",
  "vehicle_models",
];

let db: pg.Client;
let allTables: string[];
const clients = {} as Record<SessionKey, Client>;
const userId = (key: DemoUserKey) => DEMO_USERS.find((u) => u.key === key)!.id;

// Untyped view of a client, for table names chosen at run time.
const loose = (c: Client) => c as unknown as SupabaseClient;

async function visibleRows(client: Client, table: string) {
  const { data, error } = await loose(client).from(table).select("*");
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return data as Record<string, unknown>[];
}

beforeAll(async () => {
  db = await pgClient();
  await testClear(db);
  await insertCatalog(db);
  await insertWorkshopChain(db, "NCR");
  await insertWorkshopChain(db, "JPR");
  await insertGlobalRows(db);
  await db.query(
    `insert into public.idempotency (user_id, request_id, fn, payload_hash, result) values ($1, $2, 'test', 'x', '{}')`,
    [NO_PROFILE_USER.id, uuidv4()],
  );

  const keys: SessionKey[] = ["admin", "ncr_manager", "ncr_store", "jpr_manager", "jpr_store", "no_profile"];
  for (const key of keys) clients[key] = await clientAs(key);

  const { rows } = await db.query<{ relname: string }>(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`);
  allTables = rows.map((r) => r.relname);
});

afterAll(async () => {
  await db?.end();
});

describe("fixture coverage", () => {
  it("covers every workshop-scoped table", async () => {
    const { rows } = await db.query<{ table_name: string }>(`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'workshop_id'
        and table_name in (select relname from pg_class where relkind = 'r')
      order by 1`);
    expect(rows.map((r) => r.table_name)).toEqual([...WORKSHOP_TABLES, "doc_counters", "profiles"].sort());
    for (const t of WORKSHOP_TABLES) {
      for (const ws of [WORKSHOP_IDS.NCR, WORKSHOP_IDS.JPR]) {
        const { rows: c } = await db.query(`select count(*)::int as n from public.${t} where workshop_id = $1`, [ws]);
        expect(c[0].n, `${t} has fixture rows`).toBeGreaterThan(0);
      }
    }
  });
});

describe("workshop isolation", () => {
  it.each(WORKSHOP_TABLES)("Jaipur store keeper sees only Jaipur rows in %s", async (table) => {
    const rows = await visibleRows(clients.jpr_store, table);
    expect(rows.filter((r) => r.workshop_id === WORKSHOP_IDS.NCR)).toEqual([]);
    expect(rows.filter((r) => r.workshop_id === WORKSHOP_IDS.JPR).length).toBeGreaterThan(0);
    expect(rows.every((r) => r.workshop_id === WORKSHOP_IDS.JPR)).toBe(true);
  });

  it.each(WORKSHOP_TABLES)("NCR manager sees only NCR rows in %s", async (table) => {
    const rows = await visibleRows(clients.ncr_manager, table);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.workshop_id === WORKSHOP_IDS.NCR)).toBe(true);
  });

  it.each(WORKSHOP_TABLES)("admin sees both workshops in %s", async (table) => {
    const rows = await visibleRows(clients.admin, table);
    const ws = new Set(rows.map((r) => r.workshop_id));
    expect(ws.has(WORKSHOP_IDS.NCR) && ws.has(WORKSHOP_IDS.JPR)).toBe(true);
  });

  it("shows activity_log rows without a workshop to admin only", async () => {
    expect((await visibleRows(clients.admin, "activity_log")).some((r) => r.workshop_id === null)).toBe(true);
    for (const key of ["ncr_manager", "jpr_store", "no_profile"] as const) {
      expect((await visibleRows(clients[key], "activity_log")).some((r) => r.workshop_id === null)).toBe(false);
    }
  });

  it("shows app_errors to admin only", async () => {
    expect((await visibleRows(clients.admin, "app_errors")).length).toBeGreaterThan(0);
    expect(await visibleRows(clients.ncr_manager, "app_errors")).toEqual([]);
  });

  it("hides idempotency and doc_counters from everyone", async () => {
    for (const key of ["admin", "ncr_manager", "no_profile"] as const) {
      expect(await visibleRows(clients[key], "idempotency")).toEqual([]);
      expect(await visibleRows(clients[key], "doc_counters")).toEqual([]);
    }
  });
});

describe("profiles", () => {
  const ids = (rows: Record<string, unknown>[]) => rows.map((r) => r.user_id).sort();

  it("store keeper sees own row, own workshop and admin", async () => {
    expect(ids(await visibleRows(clients.ncr_store, "profiles"))).toEqual(
      [userId("admin"), userId("ncr_manager"), userId("ncr_store")].sort(),
    );
  });

  it("Jaipur manager sees Jaipur users and admin", async () => {
    expect(ids(await visibleRows(clients.jpr_manager, "profiles"))).toEqual(
      [userId("admin"), userId("jpr_manager"), userId("jpr_store")].sort(),
    );
  });

  it("admin sees every profile", async () => {
    expect(ids(await visibleRows(clients.admin, "profiles"))).toEqual(DEMO_USERS.map((u) => u.id).sort());
  });
});

describe("user without a profile", () => {
  it.each([...WORKSHOP_TABLES, "app_errors", "idempotency", "doc_counters"])("reads no rows in %s", async (table) => {
    expect(await visibleRows(clients.no_profile, table)).toEqual([]);
  });

  it.each(MASTER_TABLES)("still reads master data in %s", async (table) => {
    expect((await visibleRows(clients.no_profile, table)).length).toBeGreaterThan(0);
  });

  it("still reads workshops, demo_meta and only the admin profile", async () => {
    expect((await visibleRows(clients.no_profile, "workshops")).length).toBe(2);
    expect((await visibleRows(clients.no_profile, "demo_meta")).length).toBe(1);
    expect((await visibleRows(clients.no_profile, "profiles")).map((r) => r.user_id)).toEqual([userId("admin")]);
  });
});

describe("anon", () => {
  it("reads nothing from any public table", async () => {
    expect(allTables.length).toBeGreaterThan(20);
    for (const table of allTables) {
      const { data, error } = await loose(anonClient()).from(table).select("*").limit(1);
      expect(error?.code, table).toBe("42501");
      expect(data).toBeNull();
    }
  });
});

describe("ledger and profile writes via PostgREST", () => {
  const ncr = wsIds("NCR");
  const targets: Record<string, { insert: Record<string, unknown>; match: [string, unknown] }> = {
    stock_moves: {
      insert: { workshop_id: WORKSHOP_IDS.NCR, part_id: CAT.part, move_type: "adjust_in", qty: 1, to_bin_id: ncr.normal, reason: "x" },
      match: ["id", 1],
    },
    stock_balances: {
      insert: { workshop_id: WORKSHOP_IDS.NCR, bin_id: ncr.qrn, part_id: CAT.part, on_hand: 99 },
      match: ["bin_id", ncr.normal],
    },
    job_card_lines: {
      insert: { workshop_id: WORKSHOP_IDS.NCR, job_card_id: ncr.card, part_id: CAT.part, qty_required: 1, source: "manual" },
      match: ["id", ncr.line],
    },
    profiles: {
      insert: { user_id: NO_PROFILE_USER.id, full_name: "Intruder", role: "admin", workshop_id: null },
      match: ["user_id", userId("ncr_store")],
    },
  };
  const actors: (SessionKey | "anon")[] = [
    "admin", "ncr_manager", "ncr_store", "jpr_manager", "jpr_store", "no_profile", "anon",
  ];

  it.each(actors)("%s cannot INSERT, UPDATE or DELETE stock_moves, stock_balances, job_card_lines, profiles", async (actor) => {
    const client = loose(actor === "anon" ? anonClient() : clients[actor]);
    for (const [table, t] of Object.entries(targets)) {
      const ins = await client.from(table).insert(t.insert);
      expect(ins.error?.code, `${actor} insert ${table}`).toBe("42501");
      const upd = await client.from(table).update({ created_at: new Date(0).toISOString() }).eq(...t.match);
      expect(upd.error?.code, `${actor} update ${table}`).toBe("42501");
      const del = await client.from(table).delete().eq(...t.match);
      expect(del.error?.code, `${actor} delete ${table}`).toBe("42501");
    }
  });

  it("left the ledger untouched", async () => {
    const { rows } = await db.query(
      `select (select count(*)::int from stock_moves) as moves,
              (select sum(on_hand)::int from stock_balances) as on_hand,
              (select count(*)::int from profiles) as profiles`,
    );
    expect(rows[0]).toEqual({ moves: 6, on_hand: 12, profiles: 5 });
  });
});

describe("append-only tables as postgres", () => {
  it.each(["stock_moves", "activity_log"])("%s rejects UPDATE and DELETE", async (table) => {
    for (const sql of [`update public.${table} set created_at = created_at`, `delete from public.${table} where false`]) {
      const e = await db.query(sql).then(
        () => null,
        (err: pg.DatabaseError) => err,
      );
      expect(e?.code, sql).toBe("P0001");
      expect(e?.message).toBe("VALIDATION");
    }
  });
});

describe("master data writes", () => {
  it("admin can insert a supplier; a manager cannot", async () => {
    const row = { name: "New Supplier", city: "Jaipur", phone: "1", kind: "local_market", lead_time_days: 1 };
    const ok = await loose(clients.admin).from("suppliers").insert(row);
    expect(ok.error).toBeNull();
    const denied = await loose(clients.ncr_manager).from("suppliers").insert(row);
    expect(denied.error?.code).toBe("42501");
  });

  it("only admin can insert bins", async () => {
    const denied = await loose(clients.ncr_manager)
      .from("bins")
      .insert({ workshop_id: WORKSHOP_IDS.NCR, code: "NCR-B01-01", kind: "normal" });
    expect(denied.error?.code).toBe("42501");
  });

  it("a manager updates reorder_settings of their own workshop only", async () => {
    const own = await loose(clients.ncr_manager)
      .from("reorder_settings")
      .update({ safety_stock: 3 })
      .eq("workshop_id", WORKSHOP_IDS.NCR)
      .select();
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);

    const other = await loose(clients.ncr_manager)
      .from("reorder_settings")
      .update({ safety_stock: 3 })
      .eq("workshop_id", WORKSHOP_IDS.JPR)
      .select();
    expect(other.data).toEqual([]);

    const store = await loose(clients.ncr_store)
      .from("reorder_settings")
      .update({ safety_stock: 4 })
      .eq("workshop_id", WORKSHOP_IDS.NCR)
      .select();
    expect(store.data).toEqual([]);

    const { rows } = await db.query(`select workshop_id, safety_stock from reorder_settings order by workshop_id`);
    expect(rows).toEqual([
      { workshop_id: WORKSHOP_IDS.NCR, safety_stock: 3 },
      { workshop_id: WORKSHOP_IDS.JPR, safety_stock: 2 },
    ]);
  });
});
