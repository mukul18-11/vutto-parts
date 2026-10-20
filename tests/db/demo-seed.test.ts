// Demo seed and reset (SPEC §15, Prompt 8 tests 2, 3, 4 and 7). reset_demo is called through
// supabase-js as the admin, the way the app does. Planted codes come from planted.json.
//
// Not covered here by request: the concurrent cases of test 3 (two resets at once, reset racing
// issue_to_job_card). The try-lock and the demo:gate lock they exercise are still in place.
import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applicableMapping, FINDING_TYPES, VARIANTS } from "../../scripts/seed/catalogue";
import { uid } from "../../scripts/seed/engine";
import { clientAs, pgClient, type Client } from "./clients";
import { DEMO_USERS, signIn, WORKSHOP_IDS } from "./demo-users";
import { requireEnv } from "./env";
import { checkInvariants, expectInvariantsHold } from "./invariants";
import { applySeed, PLANTED, setCooldown } from "./seed-fixtures";

type Ws = "NCR" | "JPR";
const WORKSHOPS: Ws[] = ["NCR", "JPR"];

let db: pg.Client;
let admin: Client;

beforeAll(async () => {
  db = await pgClient();
  await setCooldown(db, 0);
  await applySeed(db);
  admin = await clientAs("admin");
});

afterEach(async () => {
  await expectInvariantsHold(db);
});

afterAll(async () => {
  if (db) {
    await setCooldown(db, 0);
    await db.end();
  }
});

async function resetAsAdmin() {
  const started = performance.now();
  const res = await admin.rpc("reset_demo");
  return { ...res, ms: performance.now() - started };
}

async function one<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  expect(rows).toHaveLength(1);
  return rows[0];
}

// ---------------------------------------------------------------------------------------------
// Test 2: reset_demo restores a healthy, fully planted demo.

describe("reset_demo (test 2)", () => {
  it("restores the seed in under 3 s with no invariant violations and profiles kept", async () => {
    const before = await one<{ n: string }>("select count(*) as n from public.profiles");
    const { data, error, ms } = await resetAsAdmin();
    expect(error).toBeNull();
    expect(ms).toBeLessThan(3000);
    expect(data).toMatchObject({ anchor_date: expect.any(String) });
    expect(await checkInvariants(db)).toEqual([]);
    const after = await one<{ n: string }>("select count(*) as n from public.profiles");
    expect(after.n).toBe(before.n);
    const meta = await one<{ today: boolean; by: string }>(
      "select anchor_date = private.ist_today() as today, last_reset_by::text as by from public.demo_meta");
    expect(meta).toEqual({ today: true, by: DEMO_USERS.find((u) => u.key === "admin")!.id });
  });

  it("has no event in the future and nothing today", async () => {
    const { rows: cols } = await db.query<{ table_name: string; column_name: string }>(
      `select c.table_name::text, c.column_name::text
       from information_schema.columns c
       where c.table_schema = 'public' and c.data_type = 'timestamp with time zone'
         and c.table_name = any (private.reset_tables())`);
    expect(cols.length).toBeGreaterThan(20);
    const union = cols
      .map((c) => `select '${c.table_name}.${c.column_name}' as col, "${c.column_name}" as ts from public."${c.table_name}"`)
      .join(" union all ");
    const { rows } = await db.query<{ col: string; future: string; today: string }>(
      `select col, count(*) filter (where ts > now()) as future,
         count(*) filter (where private.ist_date(ts) >= private.ist_today()) as today
       from (${union}) x group by col
       having count(*) filter (where ts > now() or private.ist_date(ts) >= private.ist_today()) > 0`);
    expect(rows).toEqual([]);
  });

  it("keeps every demo user able to sign in", async () => {
    const target = { url: requireEnv("SUPABASE_URL"), publishableKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
    for (const u of DEMO_USERS) {
      expect(await signIn(target, u.email, requireEnv("DEMO_PASSWORD")), u.email).not.toBeNull();
    }
  });

  describe.each(WORKSHOPS)("planted scenarios in %s", (ws) => {
    const p = PLANTED[ws];
    const wsId = WORKSHOP_IDS[ws];

    it("has the three sent POs: due tomorrow, two days overdue, partially received with damage", async () => {
      const { rows } = await db.query<{ code: string; status: string; days: number; damaged: number }>(
        `select po.code, po.status::text, po.expected_on - private.ist_today() as days,
           coalesce((select sum(gl.qty_damaged) from public.grn_lines gl join public.grns g on g.id = gl.grn_id
             where g.po_id = po.id), 0)::int as damaged
         from public.purchase_orders po where po.workshop_id = $1 and po.status in ('sent', 'partially_received')`,
        [wsId]);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const by = new Map(rows.map((r) => [r.code, r]));
      expect(by.get(p.po_due_tomorrow)).toMatchObject({ status: "sent", days: 1 });
      expect(by.get(p.po_overdue)).toMatchObject({ status: "sent", days: -2 });
      expect(by.get(p.po_partially_received)?.status).toBe("partially_received");
      expect(by.get(p.po_partially_received)!.damaged).toBeGreaterThan(0);
    });

    it("has receiving stock waiting for putaway, reserved for waiting bikes", async () => {
      const rcv = await one<{ on_hand: number }>(
        `select coalesce(sum(sb.on_hand), 0)::int as on_hand from public.stock_balances sb
         join public.bins b on b.id = sb.bin_id join public.parts pt on pt.id = sb.part_id
         where b.workshop_id = $1 and b.kind = 'receiving' and pt.sku = $2`, [wsId, p.receiving.sku]);
      expect(rcv.on_hand).toBe(p.receiving.qty);
      expect(rcv.on_hand).toBeGreaterThan(0);
      const { rows } = await db.query<{ code: string; reserved: number }>(
        `select c.code, l.qty_reserved as reserved from public.job_card_lines l
         join public.job_cards c on c.id = l.job_card_id join public.parts pt on pt.id = l.part_id
         where c.code = any ($1) and pt.sku = $2 and c.status = 'confirmed'`, [p.receiving.reserved_for, p.receiving.sku]);
      expect(rows).toHaveLength(p.receiving.reserved_for.length);
      for (const r of rows) expect(r.reserved).toBeGreaterThan(0);
    });

    it("has 3+ fully reserved cards ready to issue on arrived bikes", async () => {
      const { rows } = await db.query<{ code: string; complete: boolean; bike: string; reserved: number; issued: number }>(
        `select c.code, c.parts_complete_at is not null as complete, b.status::text as bike,
           sum(l.qty_reserved)::int as reserved, sum(l.qty_issued)::int as issued
         from public.job_cards c join public.bikes b on b.id = c.bike_id
         join public.job_card_lines l on l.job_card_id = c.id and l.cancelled_at is null
         where c.code = any ($1) and c.status = 'confirmed' group by c.code, c.parts_complete_at, b.status`,
        [p.ready_to_issue]);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const r of rows) {
        expect(r).toMatchObject({ complete: true, issued: 0 });
        expect(["at_workshop", "in_repair"]).toContain(r.bike);
        expect(r.reserved).toBeGreaterThan(0);
      }
    });

    it("has blocked bikes with mixed causes", async () => {
      const { rows } = await db.query<{ card_code: string; needs_review_reason: string | null; causes: string[] }>(
        `select bb.card_code, bb.needs_review_reason,
           coalesce(array(select case when m->>'eta_status' = 'on_po' and (m->>'is_overdue')::boolean then 'overdue_po'
                                      when m->>'eta_status' = 'on_po' then 'in_transit' else m->>'eta_status' end
                          from jsonb_array_elements(bb.missing_parts) m), '{}') as causes
         from public.v_blocked_bikes bb where bb.workshop_id = $1`, [wsId]);
      expect(rows.length).toBeGreaterThanOrEqual(ws === "NCR" ? 6 : 4);
      const by = new Map(rows.map((r) => [r.card_code, r]));
      for (const code of p.blocked.in_transit) expect(by.get(code)?.causes).toEqual(["in_transit"]);
      for (const code of p.blocked.overdue_po) expect(by.get(code)?.causes).toContain("overdue_po");
      for (const code of p.blocked.not_ordered) expect(by.get(code)?.causes).toContain("not_ordered");
      for (const code of p.blocked.flagged_fitment) {
        expect(by.get(code)?.needs_review_reason).toMatch(/^wrong_fitment: /);
      }
      expect(p.blocked.flagged_fitment).toHaveLength(ws === "NCR" ? 1 : 0);
      expect(p.blocked.not_ordered).toContain(p.unsourced.card_code);
    });

    it("has three independent demo chains, each covered exactly by its own sent PO", async () => {
      expect(p.chains.map((c) => c.label)).toEqual(["A", "B", "C"]);
      expect(new Set(p.chains.map((c) => c.sku)).size).toBe(3);
      expect(p.chains[0].po_code).toBe(p.po_due_tomorrow);
      for (const ch of p.chains) {
        const r = await one<{ bike: string; missing: number; others: number; open: number; po_lines: number; days: number }>(
          `select b.status::text as bike,
             (select count(*) from public.v_missing_parts mp where mp.job_card_id = c.id)::int as missing,
             (select count(*) from public.v_missing_parts mp where mp.workshop_id = c.workshop_id
               and mp.part_id = pt.id and mp.job_card_id <> c.id)::int as others,
             (select sum(pl.open_qty) from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id
               where pl.workshop_id = c.workshop_id and pl.part_id = pt.id
                 and po.status in ('draft', 'sent', 'partially_received'))::int as open,
             (select count(*) from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id
               where po.code = $2)::int as po_lines,
             (select po.expected_on - private.ist_today() from public.purchase_orders po where po.code = $2) as days
           from public.job_cards c join public.bikes b on b.id = c.bike_id join public.parts pt on pt.sku = $3
           where c.code = $1`, [ch.card_code, ch.po_code, ch.sku]);
        expect(r).toMatchObject({ bike: "in_repair", missing: 1, others: 0, open: 1, po_lines: 1 });
        expect(r.days).toBe(ch.label === "A" ? 1 : r.days);
        expect(r.days).toBeGreaterThanOrEqual(1);
      }
    });

    it("has 5+ auto parts at or below their reorder point with nothing on order", async () => {
      const { rows } = await db.query<{ sku: string }>(
        `select pt.sku from private.po_requirements($1, private.ist_today()) q
         join public.parts pt on pt.id = q.part_id
         where q.is_auto and q.projected <= q.rop and q.on_order = 0
           and not exists (select 1 from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id
             where pl.workshop_id = $1 and pl.part_id = q.part_id and po.status = 'draft')`, [wsId]);
      const skus = rows.map((r) => r.sku);
      expect(skus.length).toBeGreaterThanOrEqual(5);
      for (const sku of p.low_stock_auto_skus) expect(skus).toContain(sku);
    });

    it("has 8–12 dead-stock SKUs, exactly the planted ones", async () => {
      const { data, error } = await admin.rpc("dead_stock", { p_workshop_id: wsId });
      expect(error).toBeNull();
      const skus = (data as { sku: string }[]).map((r) => r.sku).sort();
      expect(skus.length).toBeGreaterThanOrEqual(8);
      expect(skus.length).toBeLessThanOrEqual(12);
      expect(skus).toEqual([...p.dead_stock_skus].sort());
    });

    it("has 1–2 emergency buys in the last 7 days", async () => {
      const r = await one<{ n: number }>(
        `select count(*)::int as n from public.emergency_buys e where e.workshop_id = $1
           and private.ist_date(e.created_at) between private.ist_today() - 7 and private.ist_today() - 1`, [wsId]);
      expect(r.n).toBeGreaterThanOrEqual(1);
      expect(r.n).toBeLessThanOrEqual(2);
    });

    it("has the unsourced part short on a confirmed card", async () => {
      const r = await one<{ uncovered: number; supplier: string | null }>(
        `select l.qty_required - (l.qty_reserved + l.qty_issued - l.qty_returned) as uncovered,
           coalesce(rs.preferred_supplier_id, pt.preferred_supplier_id)::text as supplier
         from public.job_card_lines l join public.job_cards c on c.id = l.job_card_id
         join public.parts pt on pt.id = l.part_id
         left join public.reorder_settings rs on rs.workshop_id = l.workshop_id and rs.part_id = l.part_id
         where c.code = $1 and pt.sku = $2 and c.status = 'confirmed'`, [p.unsourced.card_code, p.unsourced.sku]);
      expect(r).toEqual({ uncovered: 1, supplier: null });
    });

    it("has a bike with an unknown variant and an unresolved finding on a draft card", async () => {
      const r = await one<{ status: string; variant: string | null; reg_no: string; unresolved: number }>(
        `select c.status::text, b.variant_id::text as variant, b.reg_no,
           (select count(*) from public.inspection_findings f where f.bike_id = b.id
             and f.job_card_line_id is null and f.no_part_reason is null)::int as unresolved
         from public.job_cards c join public.bikes b on b.id = c.bike_id where c.code = $1`, [p.unknown_variant.card_code]);
      expect(r).toEqual({ status: "draft", variant: null, reg_no: p.unknown_variant.reg_no, unresolved: 1 });
    });
  });

  it("has exactly one flagged fitment: AF-JUP on JUP_BS6_DI (NCR history)", async () => {
    const { rows } = await db.query<{ sku: string; source: string; confirmed_count: number; flagged_count: number; last_flag_note: string }>(
      `select pt.sku, f.source::text, f.confirmed_count, f.flagged_count, f.last_flag_note
       from public.part_fitments f join public.parts pt on pt.id = f.part_id
       where f.flagged_count >= greatest(1, f.confirmed_count)`);
    expect(rows).toEqual([
      { sku: "AF-JUP", source: "learned", confirmed_count: 1, flagged_count: 3, last_flag_note: "Airbox clip does not match BS6 housing" },
    ]);
    expect(PLANTED.NCR.flagged_fitment).toMatchObject({ sku: "AF-JUP", variant: "JUP_BS6_DI" });
    expect(PLANTED.JPR.flagged_fitment).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Test 3 (sequential cases): cooldown and admin-only.

describe("reset_demo guards (test 3)", () => {
  it("refuses a second reset within the cooldown with RESET_COOLDOWN", async () => {
    try {
      await setCooldown(db, 120, true);
      const first = await resetAsAdmin();
      expect(first.error).toBeNull();
      const second = await resetAsAdmin();
      expect(second.error?.message).toBe("RESET_COOLDOWN");
      expect(JSON.parse(second.error!.details).retry_after_seconds).toBeGreaterThan(0);
    } finally {
      await setCooldown(db, 0);
    }
  });

  it("refuses managers and store keepers with FORBIDDEN", async () => {
    for (const key of ["ncr_manager", "jpr_store"] as const) {
      const client = await clientAs(key);
      const { error } = await client.rpc("reset_demo");
      expect(error?.message, key).toBe("FORBIDDEN");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Test 4: codes and ledger ids continue after a reset.

describe("after a reset (test 4)", () => {
  it("creates new codes past the seeded ones and keeps the ledger consistent", async () => {
    expect((await resetAsAdmin()).error).toBeNull();
    const ncr = WORKSHOP_IDS.NCR;
    const seeded = await one<{ max_move: string; cards: string[]; pos: string[]; grns: string[] }>(
      `select (select max(id) from public.stock_moves)::text as max_move,
         array(select code from public.job_cards) as cards,
         array(select code from public.purchase_orders) as pos,
         array(select code from public.grns) as grns`);
    const next = (codes: string[], prefix: string) =>
      `${prefix}-NCR-${String(Math.max(...codes.filter((c) => c.startsWith(`${prefix}-NCR-`)).map((c) => Number(c.slice(-6)))) + 1).padStart(6, "0")}`;

    const manager = await clientAs("ncr_manager");
    const store = await clientAs("ncr_store");

    // A job card code.
    const variant = VARIANTS.find((v) => v.key === "SPL_BS6_S")!;
    const bike = await manager.rpc("create_bike", {
      p_request_id: uuidv4(), p_workshop_id: ncr, p_reg_no: "DL1ZZ9999", p_model_id: uid("model:SPL"),
      p_mfg_year: 2021, p_variant_id: uid(`variant:${variant.key}`),
      p_findings: [{ finding_type_id: uid("finding_type:engine_oil_due") }],
    });
    expect(bike.error).toBeNull();
    const cardCode = (bike.data as { code: string }).code;
    expect(cardCode).toBe(next(seeded.cards, "JC"));

    // A PO code (the planted low-stock auto parts give generation work to do).
    const gen = await manager.rpc("generate_draft_pos", { p_request_id: uuidv4(), p_workshop_id: ncr });
    expect(gen.error).toBeNull();
    const draftCodes = (gen.data as { drafts: { code: string }[] }).drafts.map((d) => d.code);
    expect(draftCodes.length).toBeGreaterThan(0);
    expect(draftCodes).toContain(next(seeded.pos, "PO"));
    for (const c of draftCodes) expect(seeded.pos).not.toContain(c);

    // A GRN code: receive chain B's PO.
    const chainB = PLANTED.NCR.chains.find((c) => c.label === "B")!;
    const { rows: poLines } = await db.query<{ po_id: string; id: string }>(
      `select po.id as po_id, pl.id from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id where po.code = $1`,
      [chainB.po_code]);
    const grn = await store.rpc("receive_grn", {
      p_request_id: uuidv4(), p_po_id: poLines[0].po_id, p_supplier_invoice_no: "TEST-INV-1",
      p_invoice_date: (await one<{ d: string }>("select private.ist_today()::text as d")).d,
      p_allow_duplicate_invoice: false,
      p_lines: [{ po_line_id: poLines[0].id, qty_received: 1, qty_damaged: 0, qty_wrong_part: 0 }],
    });
    expect(grn.error).toBeNull();
    expect((grn.data as { grn: { code: string } }).grn.code).toBe(next(seeded.grns, "GRN"));

    // Put away 1 unit of the planted receiving stock, then issue 1 unit to a ready card.
    const rcvPart = await one<{ part_id: string; from_bin: string; to_bin: string }>(
      `select pt.id as part_id, r.id as from_bin,
         (select b.id from public.bins b where b.workshop_id = $1 and b.kind = 'normal' order by b.code limit 1) as to_bin
       from public.parts pt cross join public.bins r where pt.sku = $2 and r.workshop_id = $1 and r.kind = 'receiving'`,
      [ncr, PLANTED.NCR.receiving.sku]);
    const put = await store.rpc("putaway", {
      p_request_id: uuidv4(), p_part_id: rcvPart.part_id, p_from_bin_id: rcvPart.from_bin, p_to_bin_id: rcvPart.to_bin, p_qty: 1,
    });
    expect(put.error).toBeNull();

    const line = await one<{ line_id: string; bin_id: string }>(
      `select l.id as line_id,
         (select sb.bin_id from public.stock_balances sb join public.bins b on b.id = sb.bin_id
          where sb.part_id = l.part_id and b.workshop_id = l.workshop_id and b.kind = 'normal' and sb.on_hand > 0
          order by sb.on_hand desc, b.code limit 1) as bin_id
       from public.job_card_lines l join public.job_cards c on c.id = l.job_card_id join public.parts pt on pt.id = l.part_id
       where c.code = $1 and l.qty_reserved > 0 order by pt.sku limit 1`, [PLANTED.NCR.ready_to_issue[0]]);
    const issued = await store.rpc("issue_to_job_card", {
      p_request_id: uuidv4(), p_line_id: line.line_id, p_bin_id: line.bin_id, p_qty: 1,
    });
    expect(issued.error).toBeNull();

    const { rows: newMoves } = await db.query<{ id: string; move_type: string }>(
      "select id::text, move_type::text from public.stock_moves where id > $1 order by id", [seeded.max_move]);
    expect(newMoves.map((m) => m.move_type)).toEqual(["grn", "putaway", "issue"]);
    for (const m of newMoves) expect(BigInt(m.id)).toBeGreaterThan(BigInt(seeded.max_move));
    expect(await checkInvariants(db)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Test 7: every catalogue variant resolves every eligible finding (seed catalogue §5.7).

describe("catalogue coverage (test 7)", () => {
  it("gives every eligible finding on every variant at least one candidate part", async () => {
    await applySeed(db);
    const variants: string[] = [];
    const types: string[] = [];
    const labels: string[] = [];
    for (const v of VARIANTS) {
      for (const f of FINDING_TYPES) {
        if (!f.eligible(v)) continue;
        const mapping = applicableMapping(f.code, v.modelKey, v);
        expect(mapping, `${v.key} ${f.code}`).not.toBeNull();
        variants.push(uid(`variant:${v.key}`));
        types.push(mapping!.partType);
        labels.push(`${v.key} ${f.code}`);
      }
    }
    expect(labels.length).toBeGreaterThan(1000);
    const { rows } = await db.query<{ i: number }>(
      `select x.i::int from unnest($1::uuid[], $2::text[]) with ordinality as x (variant_id, part_type, i)
       where not exists (select 1 from public.part_candidates(x.variant_id, x.part_type))`, [variants, types]);
    expect(rows.map((r) => labels[r.i - 1])).toEqual([]);
  });
});
