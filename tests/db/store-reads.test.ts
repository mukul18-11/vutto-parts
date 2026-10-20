// Read views for the purchasing, receiving, putaway and stock control screens (migration
// store_purchasing_reads): v_po_list, v_grn_list, v_receiving_stock, v_count_bins and
// v_quarantine_stock. State is built through the real RPCs as the demo users; history rows that
// need explicit times are inserted as postgres. Every view is read under RLS.
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { istToday } from "../../src/lib/time";
import { clientAs, pgClient, type Client } from "./clients";
import { DEMO_USERS } from "./demo-users";
import { insertBins, testClear } from "./fixtures";
import { expectInvariantsHold } from "./invariants";
import {
  BIN2,
  confirmAs,
  createBikeAs,
  expectOk,
  FT,
  insertJobCardCatalog,
  M,
  manager,
  ncr,
  P,
  rpc,
  V,
} from "./job-card-fixtures";
import { insertPurchasingCatalog, sendPo, SUP, type Po } from "./purchasing-fixtures";

let db: pg.Client;
let ncrManager: Client;
let ncrStore: Client;
let jprManager: Client;

const storeName = DEMO_USERS.find((u) => u.key === "ncr_store")!.fullName;

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
  await insertPurchasingCatalog(db);
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  await db?.end();
});

let invoiceNo = 0;
const receive = (po: Po, lines: { sku: string; received: number; damaged?: number }[]) =>
  rpc(ncrStore, "receive_grn", {
    p_po_id: po.po_id,
    p_supplier_invoice_no: `SR-${++invoiceNo}`,
    p_invoice_date: istToday(),
    p_allow_duplicate_invoice: false,
    p_lines: lines.map((l) => ({
      po_line_id: po.lines.find((x) => x.sku === l.sku)!.line_id,
      qty_received: l.received,
      qty_damaged: l.damaged ?? 0,
      qty_wrong_part: 0,
    })),
  });

/** adjust_in as postgres with an explicit time (history row; no allocation runs). */
async function stockInAt(part: string, bin: string, qty: number, daysAgo: number) {
  await db.query(
    `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, reason, user_id, created_at)
     values ((select workshop_id from public.bins where id = $3), $1, 'adjust_in', $2, $3, 'found', $4,
             now() - make_interval(days => $5))`,
    [part, qty, bin, manager, daysAgo],
  );
}

describe("v_po_list", () => {
  it("sums lines once per PO however many GRNs it has", async () => {
    const po = await sendPo(ncrManager, [
      { part: P.oil, qty: 4, price: 32000 },
      { part: P.air, qty: 2, price: 10000 },
    ]);
    const skuOil = po.lines.find((l) => l.part_id === P.oil)!.sku;
    const skuAir = po.lines.find((l) => l.part_id === P.air)!.sku;
    expectOk(await receive(po, [{ sku: skuOil, received: 1 }]));
    expectOk(await receive(po, [{ sku: skuOil, received: 2, damaged: 1 }, { sku: skuAir, received: 1 }]));

    const { data, error } = await ncrManager.from("v_po_list").select("*").eq("id", po.po_id).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      code: po.code,
      status: "partially_received",
      supplier_name: "Delhi Parts Co",
      lead_time_days: 3,
      line_count: 2,
      qty_ordered: 6,
      qty_accepted: 3,
      qty_rejected: 1,
      qty_cancelled: 0,
      open_qty: 3,
      total_paise: 4 * 32000 + 2 * 10000,
      missing_price_count: 0,
      grn_count: 2,
      is_overdue: false,
    });
    expect(data!.last_received_at).not.toBeNull();
  });

  it("counts lines without a price and flags overdue POs", async () => {
    const draft = expectOk<Po>(
      await rpc(ncrManager, "add_draft_line", { p_workshop_id: null, p_supplier_id: SUP.ncr, p_part_id: P.oil, p_qty: 3 }),
    );
    expectOk(
      await rpc(ncrManager, "add_draft_line", {
        p_workshop_id: null,
        p_supplier_id: SUP.ncr,
        p_part_id: P.air,
        p_qty: 1,
        p_unit_price_paise: 15000,
      }),
    );
    const row = async (id: string) => (await ncrManager.from("v_po_list").select("*").eq("id", id).single()).data!;
    expect(await row(draft.po_id)).toMatchObject({
      status: "draft",
      line_count: 2,
      total_paise: 15000,
      missing_price_count: 1,
      grn_count: 0,
      is_overdue: false,
    });

    const sent = await sendPo(ncrManager, [{ part: P.shoe, qty: 1 }], SUP.jpr);
    await db.query(`update public.purchase_orders set expected_on = private.ist_today() - 1 where id = $1`, [sent.po_id]);
    expect(await row(sent.po_id)).toMatchObject({ status: "sent", is_overdue: true });
    await db.query(`update public.purchase_orders set expected_on = private.ist_today() where id = $1`, [sent.po_id]);
    expect(await row(sent.po_id)).toMatchObject({ is_overdue: false });

    // RLS: Jaipur sees no NCR POs.
    expect((await jprManager.from("v_po_list").select("id")).data).toEqual([]);
  });
});

describe("v_grn_list", () => {
  it("shows who received and the accepted value", async () => {
    const po = await sendPo(ncrManager, [{ part: P.oil, qty: 5, price: 32000 }]);
    const sku = po.lines[0].sku;
    const grn = expectOk<{ grn: { code: string } }>(await receive(po, [{ sku, received: 3, damaged: 1 }])).grn;

    const { data, error } = await ncrStore.from("v_grn_list").select("*").eq("po_id", po.po_id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      code: grn.code,
      supplier_invoice_no: `SR-${invoiceNo}`,
      invoice_date: istToday(),
      received_by_name: storeName,
      qty_received: 3,
      qty_accepted: 2,
      qty_rejected: 1,
      accepted_value_paise: 2 * 32000,
    });
    expect((await jprManager.from("v_grn_list").select("id")).data).toEqual([]);
  });
});

describe("v_receiving_stock", () => {
  type Row = {
    sku: string;
    on_hand: number;
    oldest_in_at: string;
    reserved: number;
    reserved_for: { card_code: string; reg_no: string; qty: number; arrived: boolean }[];
    suggested_bin_code: string | null;
  };
  const rows = async () =>
    (
      await ncrStore
        .from("v_receiving_stock")
        .select("sku, on_hand, oldest_in_at, reserved, reserved_for, suggested_bin_code")
        .order("sku")
    ).data as Row[];
  const daysAgo = (ts: string) => Math.round((Date.now() - Date.parse(ts)) / 86_400_000);

  it("ages the oldest unit still in the bin (FIFO), with reservations and the bin it already sits in", async () => {
    // Oil: 2 in at day −5, 3 in at day −1, 3 put away → the 2 left arrived at day −1.
    await stockInAt(P.oil, ncr.rcv, 2, 5);
    await stockInAt(P.oil, ncr.rcv, 3, 1);
    // Air filter: 2 in at day −5, 3 in at day −1, 1 put away → the 4 left include day −5 units.
    await stockInAt(P.air, ncr.rcv, 2, 5);
    await stockInAt(P.air, ncr.rcv, 3, 1);
    await stockInAt(P.air, ncr.normal, 5, 10);
    const put = (part: string, qty: number, to: string) =>
      rpc(ncrStore, "putaway", { p_part_id: part, p_from_bin_id: ncr.rcv, p_to_bin_id: to, p_qty: qty });
    expectOk(await put(P.oil, 3, ncr.normal));
    expectOk(await put(P.air, 1, BIN2));

    // A confirmed bike in transit reserves 1 oil (from the receiving stock; reservations are per part).
    const card = await createBikeAs(ncrManager, "DL1RS0001", M.splendor, V.splendorDrum, [{ finding_type_id: FT.oil, qty: 1 }]);
    await confirmAs(ncrManager, card.card_id);

    const [air, oil] = await rows();
    expect(oil).toMatchObject({ on_hand: 2, reserved: 1, suggested_bin_code: "NCR-A01-01" });
    expect(daysAgo(oil.oldest_in_at)).toBe(1);
    expect(oil.reserved_for).toEqual([{ card_id: card.card_id, card_code: card.code, reg_no: "DL1RS0001", qty: 1, arrived: false }]);

    // 5 in NCR-A01-01 beats 1 in NCR-A01-02.
    expect(air).toMatchObject({ on_hand: 4, reserved: 0, reserved_for: [], suggested_bin_code: "NCR-A01-01" });
    expect(daysAgo(air.oldest_in_at)).toBe(5);

    // Emptied rows disappear; another workshop sees nothing.
    expectOk(await put(P.air, 4, ncr.normal));
    expect((await rows()).map((r) => r.sku)).toEqual([oil.sku]);
    expect((await jprManager.from("v_receiving_stock").select("sku")).data).toEqual([]);
  });

  it("has no suggested bin when the part is in no normal bin", async () => {
    await stockInAt(P.shoe, ncr.rcv, 1, 0);
    expect(await rows()).toMatchObject([{ on_hand: 1, suggested_bin_code: null }]);
  });
});

describe("v_count_bins", () => {
  it("shows the count request and what each bin holds", async () => {
    await stockInAt(P.oil, ncr.normal, 4, 2);
    await stockInAt(P.air, ncr.normal, 1, 2);
    expectOk(await rpc(ncrStore, "request_bin_count", { p_bin_id: ncr.normal }));

    const { data, error } = await ncrManager
      .from("v_count_bins")
      .select("code, kind, count_requested_at, part_count, total_on_hand")
      .order("count_requested_at", { ascending: true, nullsFirst: false })
      .order("code");
    expect(error).toBeNull();
    expect(data![0]).toMatchObject({ code: "NCR-A01-01", kind: "normal", part_count: 2, total_on_hand: 5 });
    expect(data![0].count_requested_at).not.toBeNull();
    expect(data!.slice(1).every((b) => b.count_requested_at === null)).toBe(true);
    expect(data!.map((b) => b.code)).toContain("NCR-RCV");

    // A no-op count clears the request.
    expectOk(
      await rpc(ncrManager, "adjust_stock", {
        p_bin_id: ncr.normal,
        p_part_id: P.oil,
        p_counted_qty: 4,
        p_expected_on_hand: 4,
        p_reason: "count_correction",
      }),
    );
    const after = (await ncrManager.from("v_count_bins").select("count_requested_at").eq("code", "NCR-A01-01").single()).data;
    expect(after!.count_requested_at).toBeNull();
    expect((await jprManager.from("v_count_bins").select("code")).data!.every((b) => b.code!.startsWith("JPR-"))).toBe(true);
  });
});

describe("v_quarantine_stock", () => {
  it("lists quarantine stock with the latest move in", async () => {
    await stockInAt(P.oil, ncr.normal, 5, 3);
    expectOk(
      await rpc(ncrStore, "move_stock", {
        p_part_id: P.oil,
        p_from_bin_id: ncr.normal,
        p_to_bin_id: ncr.qrn,
        p_qty: 2,
        p_reason: "leaking seal",
      }),
    );
    const { data, error } = await ncrManager.from("v_quarantine_stock").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      bin_code: "NCR-QRN",
      part_id: P.oil,
      on_hand: 2,
      last_move_type: "move",
      last_reason: "leaking seal",
      last_user_name: storeName,
    });

    // Moved back after re-inspection (manager): the row goes once the bin is empty.
    expectOk(
      await rpc(ncrManager, "move_stock", {
        p_part_id: P.oil,
        p_from_bin_id: ncr.qrn,
        p_to_bin_id: ncr.normal,
        p_qty: 2,
        p_reason: "re-inspected",
      }),
    );
    expect((await ncrManager.from("v_quarantine_stock").select("sku")).data).toEqual([]);
    expect((await jprManager.from("v_quarantine_stock").select("sku")).data).toEqual([]);
  });
});
