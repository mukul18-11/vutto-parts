// Fixtures inserted as postgres (bypasses RLS; triggers still run). Every fixture file starts
// from private.test_clear() and builds only what it needs (SPEC §17).
import type pg from "pg";
import { DEMO_USERS, WORKSHOP_IDS } from "./demo-users";

export type WorkshopCode = keyof typeof WORKSHOP_IDS;

const userId = (key: string) => DEMO_USERS.find((u) => u.key === key)!.id;

export async function testClear(db: pg.Client): Promise<void> {
  await db.query("select private.test_clear()");
}

/** Catalogue ids shared by both workshops. */
export const CAT = {
  supplier: "10000000-0000-0000-0000-000000000001",
  model: "10000000-0000-0000-0000-000000000002",
  variant: "10000000-0000-0000-0000-000000000003",
  part: "10000000-0000-0000-0000-000000000004",
  findingType: "10000000-0000-0000-0000-000000000005",
  findingTypePart: "10000000-0000-0000-0000-000000000006",
} as const;

export async function insertCatalog(db: pg.Client): Promise<void> {
  await db.query(
    `insert into public.suppliers (id, name, city, phone, kind, lead_time_days)
     values ($1, 'Test Supplier', 'Delhi', '9999999999', 'wholesaler', 3)`,
    [CAT.supplier],
  );
  await db.query(
    `insert into public.vehicle_models (id, make, model, segment) values ($1, 'Hero', 'Splendor Plus', 'motorcycle')`,
    [CAT.model],
  );
  await db.query(
    `insert into public.model_variants
       (id, model_id, name, year_from, year_to, brake_front, brake_rear, start_type, wheels, emission, fuel)
     values ($1, $2, 'BS6 Self Alloy', 2020, null, 'drum', 'drum', 'kick_self', 'alloy', 'bs6', 'fi')`,
    [CAT.variant, CAT.model],
  );
  await db.query(
    `insert into public.parts
       (id, sku, name, category, part_type, uom, standard_price_paise, preferred_supplier_id)
     values ($1, 'TEST-OIL-1L', 'Engine oil 1L', 'consumable', 'engine_oil', 'bottle', 35000, $2)`,
    [CAT.part, CAT.supplier],
  );
  await db.query(
    `insert into public.part_fitments (part_id, variant_id, source) values ($1, $2, 'catalogue')`,
    [CAT.part, CAT.variant],
  );
  await db.query(
    `insert into public.supplier_parts (supplier_id, part_id, price_paise) values ($1, $2, 32000)`,
    [CAT.supplier, CAT.part],
  );
  await db.query(
    `insert into public.finding_types (id, code, label_en, label_hi, area)
     values ($1, 'engine_oil_due', 'Engine oil due', 'इंजन ऑयल बदलना है', 'engine')`,
    [CAT.findingType],
  );
  await db.query(
    `insert into public.finding_type_parts (id, finding_type_id, part_type, qty) values ($1, $2, 'engine_oil', 1)`,
    [CAT.findingTypePart, CAT.findingType],
  );
}

/** Deterministic per-workshop ids, e.g. a1000000-0000-0000-0000-000000000003 for NCR. */
export function wsIds(ws: WorkshopCode) {
  const p = ws === "NCR" ? "a1" : "a2";
  const id = (n: number) => `${p}000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  return {
    workshop: WORKSHOP_IDS[ws],
    rcv: id(1),
    qrn: id(2),
    normal: id(3),
    bike: id(4),
    card: id(5),
    line: id(6),
    finding: id(7),
    po: id(8),
    poLine: id(9),
    grn: id(10),
    grnLine: id(11),
    buy: id(12),
  };
}

export async function insertBins(db: pg.Client, ws: WorkshopCode): Promise<void> {
  const ids = wsIds(ws);
  await db.query(
    `insert into public.bins (id, workshop_id, code, kind) values
       ($1, $4, $5::text || '-RCV', 'receiving'),
       ($2, $4, $5::text || '-QRN', 'quarantine'),
       ($3, $4, $5::text || '-A01-01', 'normal')`,
    [ids.rcv, ids.qrn, ids.normal, ids.workshop, ws],
  );
}

/**
 * One row in every workshop-scoped table for workshop ws: bins, reorder settings, an arrived bike
 * with a confirmed, fully reserved card, a sent PO with a GRN, an emergency buy, stock moves and
 * an activity_log row. The state satisfies the SPEC §4 invariants.
 */
export async function insertWorkshopChain(db: pg.Client, ws: WorkshopCode): Promise<void> {
  const ids = wsIds(ws);
  const manager = userId(ws === "NCR" ? "ncr_manager" : "jpr_manager");
  const store = userId(ws === "NCR" ? "ncr_store" : "jpr_store");
  const w = ids.workshop;

  await insertBins(db, ws);
  await db.query(
    `insert into public.reorder_settings (workshop_id, part_id, auto, safety_stock, max_qty) values ($1, $2, true, 2, 10)`,
    [w, CAT.part],
  );
  await db.query(
    `insert into public.bikes (id, workshop_id, reg_no, model_id, variant_id, mfg_year, status, purchased_at, arrived_at)
     values ($1, $2, $3, $4, $5, 2021, 'at_workshop', now() - interval '2 days', now() - interval '1 day')`,
    [ids.bike, w, ws === "NCR" ? "DL3S AB 0001" : "RJ14 AB 0001", CAT.model, CAT.variant],
  );
  await db.query(
    `insert into public.job_cards (id, workshop_id, code, bike_id) values ($1, $2, 'JC-' || $3::text || '-000001', $4)`,
    [ids.card, w, ws, ids.bike],
  );
  await db.query(
    `insert into public.job_card_lines (id, workshop_id, job_card_id, part_id, qty_required, source)
     values ($1, $2, $3, $4, 2, 'suggested')`,
    [ids.line, w, ids.card, CAT.part],
  );
  await db.query(
    `insert into public.inspection_findings (id, workshop_id, bike_id, finding_type_id, job_card_line_id)
     values ($1, $2, $3, $4, $5)`,
    [ids.finding, w, ids.bike, CAT.findingType, ids.line],
  );
  await db.query(
    `update public.job_cards set status = 'confirmed', confirmed_at = now(), confirmed_by = $2, needed_by = current_date
     where id = $1`,
    [ids.card, manager],
  );

  await db.query(
    `insert into public.purchase_orders (id, workshop_id, code, supplier_id, status, sent_at, expected_on)
     values ($1, $2, 'PO-' || $3::text || '-000001', $4, 'partially_received', now(), current_date + 3)`,
    [ids.po, w, ws, CAT.supplier],
  );
  await db.query(
    `insert into public.po_lines (id, workshop_id, po_id, part_id, qty_ordered, qty_accepted, unit_price_paise, source)
     values ($1, $2, $3, $4, 10, 5, 32000, 'suggested')`,
    [ids.poLine, w, ids.po, CAT.part],
  );
  await db.query(
    `insert into public.grns (id, workshop_id, code, po_id, supplier_id, supplier_invoice_no, invoice_date, received_by)
     values ($1, $2, 'GRN-' || $3::text || '-000001', $4, $5, 'INV/001', current_date, $6)`,
    [ids.grn, w, ws, ids.po, CAT.supplier, store],
  );
  await db.query(
    `insert into public.grn_lines (id, workshop_id, grn_id, po_line_id, part_id, qty_received, qty_accepted, unit_price_paise)
     values ($1, $2, $3, $4, $5, 5, 5, 32000)`,
    [ids.grnLine, w, ids.grn, ids.poLine, CAT.part],
  );
  await db.query(
    `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, grn_line_id, user_id)
     values ($1, $2, 'grn', 5, $3, $4, $5)`,
    [w, CAT.part, ids.rcv, ids.grnLine, store],
  );
  await db.query(
    `insert into public.emergency_buys
       (id, workshop_id, job_card_line_id, part_id, vendor_name, qty, unit_price_paise, qty_issued, qty_to_stock, reason, bought_by)
     values ($1, $2, $3, $4, 'Local shop', 1, 40000, 0, 1, 'no_stock', $5)`,
    [ids.buy, w, ids.line, CAT.part, store],
  );
  await db.query(
    `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, emergency_buy_id, user_id)
     values ($1, $2, 'emergency_in', 1, $3, $4, $5)`,
    [w, CAT.part, ids.rcv, ids.buy, store],
  );
  await db.query(
    `insert into public.stock_moves (workshop_id, part_id, move_type, qty, from_bin_id, to_bin_id, user_id)
     values ($1, $2, 'putaway', 3, $3, $4, $5)`,
    [w, CAT.part, ids.rcv, ids.normal, store],
  );
  // Reserve the line fully (usable 6, reserved 2), so the card is complete.
  await db.query(`update public.job_card_lines set qty_reserved = 2 where id = $1`, [ids.line]);
  await db.query(`update public.job_cards set parts_complete_at = now() where id = $1`, [ids.card]);

  await db.query(
    `insert into public.activity_log (workshop_id, entity_type, entity_id, action, user_id)
     values ($1, 'job_card', $2, 'confirm', $3)`,
    [w, ids.card, manager],
  );
}

/** Rows that belong to no workshop: an admin-only activity_log row and an app_errors row. */
export async function insertGlobalRows(db: pg.Client): Promise<void> {
  await db.query(
    `insert into public.activity_log (workshop_id, entity_type, entity_id, action, user_id)
     values (null, 'demo', gen_random_uuid(), 'reset', $1)`,
    [userId("admin")],
  );
  await db.query(
    `insert into public.app_errors (user_id, route, code, message) values ($1, '/test', 'TEST', 'fixture')`,
    [userId("admin")],
  );
}
