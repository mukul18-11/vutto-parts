// Read SQL for the manager screens (migration ui_reads): blocked board KPI strip, bikes list with
// the current job card, a card's findings with the applicable part type (SPEC §9.1 step 1), and a
// card's history from activity_log, all under RLS.
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clientAs, pgClient, type Client } from "./clients";
import { insertBins, testClear } from "./fixtures";
import { expectInvariantsHold } from "./invariants";
import {
  arriveAs,
  confirmAs,
  createBikeAs,
  expectOk,
  FT,
  insertJobCardCatalog,
  lineOf,
  M,
  NCR,
  JPR,
  rpc,
  stockIn,
  V,
  type Card,
} from "./job-card-fixtures";

let db: pg.Client;
let ncrManager: Client;
let ncrStore: Client;
let jprManager: Client;
let admin: Client;

beforeAll(async () => {
  db = await pgClient();
  ncrManager = await clientAs("ncr_manager");
  ncrStore = await clientAs("ncr_store");
  jprManager = await clientAs("jpr_manager");
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

type Kpis = {
  blocked_n: number;
  avg_wait_hours: number | null;
  week_start: string;
  emergency_week_n: number;
  emergency_week_paise: number;
  po_overdue_n: number;
};

async function kpis(c: Client, workshop: string | null, asOf: string): Promise<Kpis> {
  const { data, error } = await c.rpc("blocked_board_kpis", { p_workshop_id: workshop as string, p_as_of: asOf });
  expect(error).toBeNull();
  return (data as Kpis[])[0];
}

const istToday = async () => (await db.query("select private.ist_today()::text as d")).rows[0].d as string;

describe("blocked_board_kpis", () => {
  it("is empty with no blocked bikes, and the week starts on Monday (IST)", async () => {
    const sunday = await kpis(ncrManager, NCR, "2026-10-18");
    expect(sunday).toMatchObject({
      blocked_n: 0,
      avg_wait_hours: null,
      week_start: "2026-10-12",
      emergency_week_n: 0,
      emergency_week_paise: 0,
      po_overdue_n: 0,
    });
    expect((await kpis(ncrManager, NCR, "2026-10-19")).week_start).toBe("2026-10-19");
    expect((await kpis(ncrManager, NCR, "2026-10-25")).week_start).toBe("2026-10-19");
  });

  it("counts blocked bikes, this week's emergency buys and overdue POs, per workshop", async () => {
    const card = await createBikeAs(ncrManager, "DL1KP0001", M.splendor, V.splendorDrum, [{ finding_type_id: FT.brake }]);
    await confirmAs(ncrManager, card.card_id);
    await arriveAs(ncrStore, card);

    // An emergency buy of 2 shoes at 300 rupees covers the first bike's line; the second bike
    // waits for engine oil (none in stock) and stays blocked.
    const other = await createBikeAs(ncrManager, "DL1KP0002", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    await confirmAs(ncrManager, other.card_id);
    await arriveAs(ncrStore, other);
    expectOk(
      await rpc(ncrStore, "record_emergency_buy", {
        p_line_id: card.lines[0].line_id,
        p_qty: 2,
        p_unit_price_paise: 30000,
        p_vendor_name: "Local shop",
        p_reason: "no_stock",
      }),
    );

    await db.query(
      `insert into public.suppliers (id, name, city, phone, kind, lead_time_days) values
         ('d1000000-0000-0000-0000-000000000091', 'S1', 'Delhi', '9800000000', 'wholesaler', 2)`,
    );
    await db.query(
      `insert into public.purchase_orders (workshop_id, code, supplier_id, status, sent_at, expected_on) values
         ($1, 'PO-NCR-000901', 'd1000000-0000-0000-0000-000000000091', 'sent', now() - interval '5 days', private.ist_today() - 1),
         ($1, 'PO-NCR-000902', 'd1000000-0000-0000-0000-000000000091', 'sent', now(), private.ist_today() + 3),
         ($2, 'PO-JPR-000903', 'd1000000-0000-0000-0000-000000000091', 'sent', now() - interval '5 days', private.ist_today() - 1)`,
      [NCR, JPR],
    );

    const today = await istToday();
    const k = await kpis(ncrManager, NCR, today);
    expect(k.blocked_n).toBe(1);
    expect(Number(k.avg_wait_hours)).toBeGreaterThanOrEqual(0);
    expect(k.emergency_week_n).toBe(1);
    expect(Number(k.emergency_week_paise)).toBe(60000);
    expect(k.po_overdue_n).toBe(1);

    // Jaipur sees only its own overdue PO; admin with null sees both workshops.
    expect(await kpis(jprManager, JPR, today)).toMatchObject({ blocked_n: 0, emergency_week_n: 0, po_overdue_n: 1 });
    expect(await kpis(jprManager, NCR, today)).toMatchObject({ blocked_n: 0, emergency_week_n: 0, po_overdue_n: 0 });
    expect(await kpis(admin, null, today)).toMatchObject({ blocked_n: 1, emergency_week_n: 1, po_overdue_n: 2 });

    // Last week's buy is not this week's.
    await db.query(`update public.emergency_buys set created_at = now() - interval '8 days'`);
    expect((await kpis(ncrManager, NCR, today)).emergency_week_n).toBe(0);
  });
});

type BikeRow = { id: string; card_id: string | null; card_code: string | null; card_status: string | null };

describe("v_bike_list", () => {
  it("shows the open card, else the latest card", async () => {
    const card = await createBikeAs(ncrManager, "DL1BL0001", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    const row = async () =>
      (await ncrManager.from("v_bike_list").select("id, card_id, card_code, card_status").eq("id", card.bike_id))
        .data as BikeRow[];

    expect(await row()).toEqual([{ id: card.bike_id, card_id: card.card_id, card_code: card.code, card_status: "draft" }]);

    expectOk(await rpc(ncrManager, "cancel_job_card", { p_card_id: card.card_id, p_reason: "test" }));
    expect((await row())[0]).toMatchObject({ card_id: card.card_id, card_status: "cancelled" });

    const next = expectOk<Card & { created: boolean }>(await rpc(ncrManager, "create_job_card", { p_bike_id: card.bike_id }));
    expect((await row())[0]).toMatchObject({ card_id: next.card_id, card_status: "draft" });

    // RLS: Jaipur sees no NCR bikes.
    expect((await jprManager.from("v_bike_list").select("id")).data).toEqual([]);
  });
});

type FindingRow = { finding_type_id: string; applicable_part_type: string | null; job_card_line_id: string | null };

describe("v_job_card_findings", () => {
  const findings = async (card: string) =>
    (
      await ncrManager
        .from("v_job_card_findings")
        .select("finding_type_id, applicable_part_type, job_card_line_id")
        .eq("job_card_id", card)
    ).data as FindingRow[];

  it("resolves the applicable part type from the bike's attributes", async () => {
    const drum = await createBikeAs(ncrManager, "DL1FT0001", M.splendor, V.splendorDrum, [{ finding_type_id: FT.brake }]);
    const disc = await createBikeAs(ncrManager, "DL1FT0002", M.pulsar, V.pulsarDisc, [{ finding_type_id: FT.brake }]);
    expect(await findings(drum.card_id)).toEqual([
      { finding_type_id: FT.brake, applicable_part_type: "front_brake_shoe", job_card_line_id: drum.lines[0].line_id },
    ]);
    expect((await findings(disc.card_id))[0].applicable_part_type).toBe("front_brake_pad");
  });

  it("with an unknown variant matches only null and segment rows", async () => {
    const card = await createBikeAs(ncrManager, "DL1FT0003", M.splendor, null, [
      { finding_type_id: FT.brake },
      { finding_type_id: FT.air },
      { finding_type_id: FT.chain },
    ]);
    const byType = Object.fromEntries((await findings(card.card_id)).map((f) => [f.finding_type_id, f]));
    expect(byType[FT.brake].applicable_part_type).toBeNull();
    expect(byType[FT.air].applicable_part_type).toBe("air_filter");
    expect(byType[FT.chain].applicable_part_type).toBe("chain_kit");
    expect(byType[FT.chain].job_card_line_id).toBeNull();
    expect((await jprManager.from("v_job_card_findings").select("id")).data).toEqual([]);
  });
});

type HistoryRow = { action: string; entity_type: string; user_full_name: string | null };

describe("job_card_history", () => {
  it("lists card, bike, line and finding events newest first, with names", async () => {
    await stockIn(db, 5);
    const card = await createBikeAs(ncrManager, "DL1HS0001", M.splendor, V.splendorDrum, [
      { finding_type_id: FT.oil },
      { finding_type_id: FT.chain },
    ]);
    const chain = card.unresolved_findings[0].finding_id;
    expectOk(await rpc(ncrManager, "resolve_finding", { p_finding_id: chain, p_no_part_reason: "Chain fine after cleaning" }));
    const confirmed = await confirmAs(ncrManager, card.card_id);
    await arriveAs(ncrStore, card);
    expectOk(
      await rpc(ncrManager, "set_line_qty", { p_line_id: lineOf(confirmed, "T-OIL").line_id, p_qty: 1, p_reason: "less" }),
    );

    const { data, error } = await ncrManager.rpc("job_card_history", { p_card_id: card.card_id });
    expect(error).toBeNull();
    const rows = data as HistoryRow[];
    expect(rows.map((r) => r.action)).toEqual([
      "set_line_qty",
      "mark_arrived",
      "confirm_job_card",
      "resolve_finding",
      "create_bike",
    ]);
    expect(rows.map((r) => r.entity_type)).toEqual(["job_card_line", "bike", "job_card", "inspection_finding", "bike"]);
    expect(rows[1].user_full_name).toBeTruthy();
    expect(rows[0].user_full_name).toBeTruthy();

    const jpr = await jprManager.rpc("job_card_history", { p_card_id: card.card_id });
    expect(jpr.data).toEqual([]);
  });

  it("includes a reallocation on the giving card", async () => {
    await stockIn(db, 2);
    const a = await createBikeAs(ncrManager, "DL1HS0002", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    const b = await createBikeAs(ncrManager, "DL1HS0003", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil }]);
    const ca = await confirmAs(ncrManager, a.card_id);
    const cb = await confirmAs(ncrManager, b.card_id);
    expect(lineOf(ca, "T-OIL").qty_reserved).toBe(2);
    expectOk(
      await rpc(ncrManager, "reallocate_reservation", {
        p_from_line_id: lineOf(ca, "T-OIL").line_id,
        p_to_line_id: lineOf(cb, "T-OIL").line_id,
        p_qty: 1,
        p_reason: "b first",
      }),
    );
    for (const card of [a, b]) {
      const { data } = await ncrManager.rpc("job_card_history", { p_card_id: card.card_id });
      expect((data as HistoryRow[])[0].action).toBe("reallocate_reservation");
    }
  });
});
