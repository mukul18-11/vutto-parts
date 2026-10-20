// Seed-dependent tests (SPEC §17): they start from private.apply_seed(private.ist_today()) and
// read planted codes from scripts/seed/planted.json, never hard-coding them.
import type pg from "pg";
import planted from "../../scripts/seed/planted.json";
import type { Planted } from "../../scripts/seed/generate";

export const PLANTED = planted as Planted;

/** Re-applies the demo seed (as postgres, with the 30 s timeout the reset itself uses). */
export async function applySeed(db: pg.Client): Promise<void> {
  await db.query("set statement_timeout = '30s'");
  await db.query("select private.apply_seed(private.ist_today())");
  await db.query("reset statement_timeout");
}

export async function setCooldown(db: pg.Client, seconds: number, clearLastReset = false): Promise<void> {
  await db.query(
    `update public.demo_meta set cooldown_seconds = $1,
       last_reset_at = case when $2 then null else last_reset_at end
     where id = 1`,
    [seconds, clearLastReset],
  );
}
