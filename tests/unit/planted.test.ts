// The admin page reads scripts/seed/planted.json through src/lib/planted.ts (SPEC §15); the
// committed file must match its schema, or the page (and the build) would fail.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { planted, plantedSchema } from "@/lib/planted";

it("the committed planted.json parses with the schema the admin page uses", () => {
  const raw: unknown = JSON.parse(readFileSync("scripts/seed/planted.json", "utf8"));
  expect(plantedSchema.safeParse(raw).success).toBe(true);
  expect(planted.NCR.chains.map((c) => c.label)).toEqual(["A", "B", "C"]);
  expect(planted.JPR.flagged_fitment).toBeNull();
});
