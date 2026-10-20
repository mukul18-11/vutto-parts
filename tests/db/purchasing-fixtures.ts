// Shared purchasing fixtures (SPEC §7), on top of the job card catalogue: two suppliers, preferred
// suppliers and supplier prices, plus small PO helpers.
import type pg from "pg";
import type { Client } from "./clients";
import { expectOk, id, NCR, P, rpc } from "./job-card-fixtures";

/** NCR default supplier (lead 3) and a Jaipur supplier (lead 1). */
export const SUP = { ncr: id(51), jpr: id(52) };

export type PoLine = {
  line_id: string;
  part_id: string;
  sku: string;
  qty_ordered: number;
  qty_accepted: number;
  qty_cancelled: number;
  open_qty: number;
  unit_price_paise: number | null;
  source: string;
};
export type Po = { po_id: string; code: string; status: string; expected_on: string | null; lines: PoLine[] };

/** Suppliers; oil, RE oil, shoe and air filter prefer the NCR supplier; supplier prices for both oils. */
export async function insertPurchasingCatalog(db: pg.Client): Promise<void> {
  await db.query(
    `insert into public.suppliers (id, name, city, phone, kind, lead_time_days) values
       ($1, 'Delhi Parts Co', 'Delhi', '9811111111', 'wholesaler', 3),
       ($2, 'Jaipur Auto Spares', 'Jaipur', '9822222222', 'local_market', 1)`,
    [SUP.ncr, SUP.jpr],
  );
  await db.query(`update public.parts set preferred_supplier_id = $1 where id = any($2)`, [
    SUP.ncr,
    [P.oil, P.reOil, P.shoe, P.air],
  ]);
  await db.query(
    `insert into public.supplier_parts (supplier_id, part_id, supplier_code, price_paise) values
       ($1, $2, 'DP-OIL', 32000), ($1, $3, null, 50000)`,
    [SUP.ncr, P.oil, P.reOil],
  );
}

export async function insertReorder(
  db: pg.Client,
  part: string,
  ws: string,
  auto: boolean,
  safety: number,
  max: number,
  supplier: string | null = null,
): Promise<void> {
  await db.query(
    `insert into public.reorder_settings (workshop_id, part_id, auto, safety_stock, max_qty, preferred_supplier_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [ws, part, auto, safety, max, supplier],
  );
}

/** Every PO line of the workshop's POs, in a stable order. */
export async function poLines(db: pg.Client, ws: string = NCR) {
  return (
    await db.query(
      `select po.id as po_id, po.code, po.status, po.supplier_id, pl.id as line_id, p.sku, pl.qty_ordered,
              pl.unit_price_paise::int as unit_price_paise, pl.source
       from public.purchase_orders po
       left join public.po_lines pl on pl.po_id = po.id
       left join public.parts p on p.id = pl.part_id
       where po.workshop_id = $1
       order by po.code, p.sku`,
      [ws],
    )
  ).rows;
}

/** A sent PO built through add_draft_line + send_po as the given manager. */
export async function sendPo(
  manager: Client,
  lines: { part: string; qty: number; price?: number }[],
  supplier: string = SUP.ncr,
): Promise<Po> {
  let po: Po | undefined;
  for (const l of lines) {
    po = expectOk<Po>(
      await rpc(manager, "add_draft_line", {
        p_workshop_id: null,
        p_supplier_id: supplier,
        p_part_id: l.part,
        p_qty: l.qty,
        p_unit_price_paise: l.price ?? 32000,
      }),
    );
  }
  return expectOk<{ po: Po }>(await rpc(manager, "send_po", { p_po_id: po!.po_id })).po;
}
