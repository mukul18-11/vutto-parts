// Shared catalogue and RPC helpers for the job card test files (SPEC §3.2, §5, §9.1).
// Catalogue (inserted as postgres): Splendor drum, Pulsar disc and Classic 350 variants; brake
// shoe/pad with fitments; a universal engine oil and an RE oil with qty_per_bike 3; finding
// types with attribute-conditional mappings.
import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { expect } from "vitest";
import type { Database } from "../../src/lib/database.types";
import type { Client } from "./clients";
import { DEMO_USERS, WORKSHOP_IDS } from "./demo-users";
import { wsIds } from "./fixtures";

type Fns = Database["public"]["Functions"];
export type Args<F extends keyof Fns> = Omit<Fns[F]["Args"], "p_request_id" | "p_workshop_id"> & {
  p_request_id?: string;
  p_workshop_id?: string | null;
};
export type RpcResult = { data: unknown; error: { message: string; code?: string; details?: string } | null };

export type Line = {
  line_id: string;
  part_id: string;
  sku: string;
  qty_required: number;
  qty_reserved: number;
  source: string;
  status: string;
  finding_ids: string[];
};
export type Card = {
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
export type Finding = { finding_type_id: string; qty?: number | null; notes?: string | null };

export const NCR = WORKSHOP_IDS.NCR;
export const JPR = WORKSHOP_IDS.JPR;
export const ncr = wsIds("NCR");
export const jpr = wsIds("JPR");
export const manager = DEMO_USERS.find((u) => u.key === "ncr_manager")!.id;
export const id = (i: number) => `d1000000-0000-0000-0000-${String(i).padStart(12, "0")}`;

export const M = { splendor: id(1), pulsar: id(2), classic: id(3) };
export const V = { splendorDrum: id(11), pulsarDisc: id(12), classic: id(13) };
export const P = {
  shoe: id(21),
  pad: id(22),
  oil: id(23),
  reOil: id(24),
  air: id(25),
  shoe2: id(26),
  shoe3: id(27),
};
export const FT = { brake: id(31), oil: id(32), topup: id(33), air: id(34), chain: id(35) };
/** NCR-A01-02, an empty normal bin. */
export const BIN2 = id(41);

export const rpc = <F extends keyof Fns>(c: Client, fn: F, args: Args<F>) =>
  c.rpc(fn, { p_request_id: uuidv4(), ...args } as never) as unknown as Promise<RpcResult>;

export function expectCode(res: RpcResult, code: string) {
  expect(res.error?.message, JSON.stringify(res.error)).toBe(code);
}

export function expectOk<T = Record<string, unknown>>(res: RpcResult): T {
  expect(res.error, JSON.stringify(res.error)).toBeNull();
  return res.data as T;
}

export const detail = (res: RpcResult) => JSON.parse(res.error?.details ?? "{}");

export const skus = (card: Card) => card.lines.map((l) => l.sku).sort();
export const lineOf = (card: Card, sku: string) => card.lines.find((l) => l.sku === sku)!;

export async function createBikeAs(
  c: Client,
  reg: string,
  model: string,
  variant: string | null,
  findings: Finding[],
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

export async function confirmAs(c: Client, card: string): Promise<Card> {
  return expectOk<Card>(await rpc(c, "confirm_job_card", { p_card_id: card }));
}

/** adjust_in as postgres (fixture stock; no allocation runs). */
export async function stockIn(db: pg.Client, qty: number, part: string = P.oil, bin: string = ncr.normal) {
  await db.query(
    `insert into public.stock_moves (workshop_id, part_id, move_type, qty, to_bin_id, reason, user_id)
     values ((select workshop_id from public.bins where id = $3), $1, 'adjust_in', $2, $3, 'found', $4)`,
    [part, qty, bin, manager],
  );
}

export async function queryOne<T = Record<string, unknown>>(
  db: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  return (await db.query(sql, params)).rows[0] as T;
}

export async function insertJobCardCatalog(db: pg.Client): Promise<void> {
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
  await db.query(`insert into public.bins (id, workshop_id, code, kind) values ($1, $2, 'NCR-A01-02', 'normal')`, [
    BIN2,
    NCR,
  ]);
}

/** purchased -> at_workshop (store keeper). */
export async function arriveAs(store: Client, card: Card): Promise<void> {
  expectOk(await rpc(store, "mark_arrived", { p_bike_id: card.bike_id }));
}

/** purchased -> at_workshop -> in_repair. */
export async function toRepairAs(store: Client, manager: Client, card: Card): Promise<void> {
  await arriveAs(store, card);
  expectOk(await rpc(manager, "start_repair", { p_bike_id: card.bike_id }));
}

export type IssueLine = {
  line_id: string;
  card_code: string;
  sku: string;
  qty_required: number;
  qty_reserved: number;
  qty_issued: number;
  qty_returned: number;
  net_issued: number;
  status: string;
  cancelled_at: string | null;
};

export const issueAs = (c: Client, line: string, bin: string, qty: number, requestId?: string) =>
  rpc(c, "issue_to_job_card", {
    p_line_id: line,
    p_bin_id: bin,
    p_qty: qty,
    ...(requestId ? { p_request_id: requestId } : {}),
  });
