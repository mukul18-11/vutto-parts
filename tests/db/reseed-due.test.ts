// Scheduled reseed decision (SPEC §15, Prompt 8 test 5): private.reseed_due with explicit times,
// so nothing depends on the wall clock (SPEC §17).
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgClient } from "./clients";

let db: pg.Client;

beforeAll(async () => {
  db = await pgClient();
});

afterAll(async () => {
  await db?.end();
});

async function due(now: string, anchor: string | null, lastActivity: string | null): Promise<boolean> {
  const { rows } = await db.query<{ due: boolean }>(
    "select private.reseed_due($1::timestamptz, $2::date, $3::timestamptz) as due",
    [now, anchor, lastActivity],
  );
  return rows[0].due;
}

const NIGHT = "2026-10-20T03:00:00+05:30";
const TWO_DAYS_EARLIER = "2026-10-18T03:00:00+05:30";
const OLD_ANCHOR = "2026-10-17";

describe("private.reseed_due (test 5)", () => {
  it("is true at 03:00 IST with no activity for 2 days and an old anchor", async () => {
    expect(await due(NIGHT, OLD_ANCHOR, TWO_DAYS_EARLIER)).toBe(true);
  });

  it("is false at 10:00 IST", async () => {
    expect(await due("2026-10-20T10:00:00+05:30", OLD_ANCHOR, TWO_DAYS_EARLIER)).toBe(false);
  });

  it("is false with activity 3 hours earlier", async () => {
    expect(await due(NIGHT, OLD_ANCHOR, "2026-10-20T00:00:00+05:30")).toBe(false);
  });

  it("is false when the anchor is that IST day", async () => {
    expect(await due(NIGHT, "2026-10-20", TWO_DAYS_EARLIER)).toBe(false);
  });

  it("uses the IST date and hour, not UTC (21:30 UTC is 03:00 IST the next day)", async () => {
    expect(await due("2026-10-19T21:30:00Z", "2026-10-19", null)).toBe(true);
    expect(await due("2026-10-19T21:30:00Z", "2026-10-20", null)).toBe(false);
  });
});
