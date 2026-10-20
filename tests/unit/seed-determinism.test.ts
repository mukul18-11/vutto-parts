// The seed generator is deterministic (SPEC §15, Prompt 8 test 1): two runs give a byte-identical
// template.sql and planted.json, also in a process with another TZ (unit tests run under
// TZ=America/Los_Angeles; the child runs under Asia/Kolkata).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSeed } from "../../scripts/seed/generate";

const hash = (o: ReturnType<typeof generateSeed>) =>
  createHash("sha256").update(o.sql).update(JSON.stringify(o.planted)).digest("hex");

describe("seed generator determinism (test 1)", () => {
  it("produces identical output on two runs", () => {
    const a = generateSeed();
    const b = generateSeed();
    expect(b.sql === a.sql).toBe(true);
    expect(b.planted).toEqual(a.planted);
  });

  it("produces identical output under another TZ", () => {
    const script = fileURLToPath(new URL("../../scripts/seed/generate.ts", import.meta.url));
    const out = execFileSync(process.execPath, ["--import", "tsx", script, "--hash"], {
      env: { ...process.env, TZ: "Asia/Kolkata" },
      encoding: "utf8",
    }).trim();
    expect(process.env.TZ).toBe("America/Los_Angeles");
    expect(out).toBe(hash(generateSeed()));
  }, 60_000);
});
