import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_MESSAGES, errorMessage, parseRpcError } from "@/lib/errors";

describe("ERROR_CODES", () => {
  it("is exactly the SPEC §11.4 list", () => {
    const spec = readFileSync("docs/SPEC.md", "utf8");
    const line = spec.split("\n").find((l) => l.includes("Codes (one TS const in src/lib/errors.ts"));
    expect(line).toBeDefined();
    const list = line!.slice(line!.indexOf("):") + 2, line!.indexOf(". Unknown errors"));
    const specCodes = list.split(",").map((c) => c.trim());
    expect([...ERROR_CODES]).toEqual(specCodes);
  });

  it("covers every code the migrations raise", () => {
    const dir = "supabase/migrations";
    const raised = new Set<string>();
    for (const file of readdirSync(dir)) {
      for (const m of readFileSync(`${dir}/${file}`, "utf8").matchAll(/err\('([A-Z_]+)'/g)) raised.add(m[1]!);
    }
    expect(raised.size).toBeGreaterThan(10);
    for (const code of raised) expect(ERROR_CODES).toContain(code);
  });
});

describe("parseRpcError", () => {
  it("reads MESSAGE as the code and DETAIL as JSON", () => {
    const parsed = parseRpcError({ code: "P0001", message: "INSUFFICIENT_BIN_STOCK", details: '{"available":2}' });
    expect(parsed).toMatchObject({ code: "INSUFFICIENT_BIN_STOCK", detail: { available: 2 }, retryable: false });
  });

  it("keeps the code when DETAIL is not JSON or missing", () => {
    expect(parseRpcError({ code: "P0001", message: "NOT_FOUND", details: "not json" })).toMatchObject({
      code: "NOT_FOUND",
      detail: null,
    });
    expect(parseRpcError({ code: "P0001", message: "FORBIDDEN", details: null }).detail).toBeNull();
  });

  it("treats an unknown P0001 message and other SQLSTATEs as UNKNOWN", () => {
    expect(parseRpcError({ code: "P0001", message: "SOMETHING_ELSE" }).code).toBe("UNKNOWN");
    expect(parseRpcError({ code: "23505", message: "duplicate key" }).code).toBe("UNKNOWN");
    expect(parseRpcError({}).code).toBe("UNKNOWN");
  });

  it("does not trust a code-like message with another SQLSTATE", () => {
    expect(parseRpcError({ code: "XX000", message: "FORBIDDEN" }).code).toBe("UNKNOWN");
  });

  it.each(["PGRST301", "PGRST303"])("maps expired JWT %s to SESSION_EXPIRED", (code) => {
    expect(parseRpcError({ code, message: "JWT expired" }).code).toBe("SESSION_EXPIRED");
  });

  it.each(["55P03", "40P01"])("marks %s (lock timeout / deadlock) as retryable", (code) => {
    expect(parseRpcError({ code, message: "x" })).toMatchObject({ code: "UNKNOWN", retryable: true });
  });
});

describe("errorMessage", () => {
  it("returns the localized text for a code", () => {
    expect(errorMessage("NOT_FOUND", "en")).toBe(ERROR_MESSAGES.NOT_FOUND.en);
    expect(errorMessage("NOT_FOUND", "hi")).toBe(ERROR_MESSAGES.NOT_FOUND.hi);
  });

  it("includes the ref for UNKNOWN", () => {
    expect(errorMessage("UNKNOWN", "en", "1234")).toBe("Something went wrong (ref 1234)");
    expect(errorMessage("UNKNOWN", "hi", "1234")).toContain("1234");
  });
});
