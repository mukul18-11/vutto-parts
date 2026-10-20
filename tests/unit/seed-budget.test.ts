// Demo seed row budget (SPEC §15, Prompt 8 test 6): the template stays under 60,000 rows.
import { describe, expect, it } from "vitest";
import { generateSeed, SEED_TABLES } from "../../scripts/seed/generate";

describe("demo seed template", () => {
  it("stays under 60,000 rows", () => {
    const { counts, sql } = generateSeed();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(
      [`template rows: ${total}`, ...Object.entries(counts).map(([t, n]) => `  ${t.padEnd(20)} ${n}`)].join("\n"),
    );
    expect(Object.keys(counts)).toEqual([...SEED_TABLES, "meta"]);
    expect(total).toBeLessThan(60_000);
    expect(sql.startsWith("-- Generated")).toBe(true);
    expect(sql).not.toMatch(/\bCOPY\b/);
  });
});
