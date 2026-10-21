// Keeps the security and correctness greps of the final review permanent (CLAUDE.md rules 3, 4,
// 7, 8; SPEC §2, §12): app code never names the secret key, never reads JWT metadata, never
// caches user data, never parses money with floats and never parses date strings with Date.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve("src");
const SKIP = new Set([path.join(SRC, "lib", "database.types.ts")]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !SKIP.has(full) ? [full] : [];
  });
}

const FORBIDDEN: [string, RegExp][] = [
  // env.client.ts names the "sb_secret_" prefix only to refuse it as the publishable key.
  ["the secret key", /SERVICE_ROLE|service_role|sb_secret_[A-Za-z0-9]/],
  ["JWT metadata", /user_metadata|app_metadata/],
  ["cached user data", /unstable_cache|["']use cache["']/],
  ["float money parsing", /parseFloat\(/],
  ["an unverified session read", /auth\.getSession\(/],
  ["Date parsing of a date string", /new Date\(\s*["'`]\d{4}-/],
];

describe("source guards", () => {
  const files = sourceFiles(SRC);

  it("finds the app sources", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(FORBIDDEN)("src never uses %s", (_label, pattern) => {
    const hits = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (pattern.test(line) ? [`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
