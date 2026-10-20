import type pg from "pg";
import { expect } from "vitest";

export type InvariantRow = { invariant: string; details: Record<string, unknown> };

export async function checkInvariants(db: pg.Client): Promise<InvariantRow[]> {
  return (await db.query<InvariantRow>("select * from private.check_invariants()")).rows;
}

/** SPEC §17: after every test, check_invariants() returns no rows. */
export async function expectInvariantsHold(db: pg.Client): Promise<void> {
  expect(await checkInvariants(db)).toEqual([]);
}
