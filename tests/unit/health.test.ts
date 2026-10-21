import { describe, expect, it } from "vitest";
import { classifyFailure, DB_UNAVAILABLE_MESSAGE, healthResponse } from "@/lib/health";

describe("healthResponse (SPEC §16)", () => {
  it("is 200 with the schema version and commit", () => {
    expect(healthResponse({ data: { ok: true, schema_version: "20261020211730" }, error: null }, "abc1234")).toEqual({
      status: 200,
      body: { ok: true, schema_version: "20261020211730", commit: "abc1234" },
    });
  });

  it.each([
    ["an RPC error", { data: null, error: { message: "fetch failed" } }],
    ["a body without a version", { data: { ok: true }, error: null }],
    ["an unreachable database", "unreachable" as const],
  ])("is 503 with a clear body for %s", (_label, result) => {
    expect(healthResponse(result, "abc1234")).toEqual({
      status: 503,
      body: { ok: false, code: "DATABASE_UNAVAILABLE", message: DB_UNAVAILABLE_MESSAGE, commit: "abc1234" },
    });
  });
});

describe("classifyFailure", () => {
  it("says unavailable when the health probe fails, returns 5xx, or the device is offline", () => {
    expect(classifyFailure({ online: true, status: null })).toBe("unavailable");
    expect(classifyFailure({ online: true, status: 503 })).toBe("unavailable");
    expect(classifyFailure({ online: true, status: 500 })).toBe("unavailable");
    expect(classifyFailure({ online: false, status: 200 })).toBe("unavailable");
  });

  it("shows a real error when the database is healthy", () => {
    expect(classifyFailure({ online: true, status: 200 })).toBe("error");
    expect(classifyFailure({ online: true, status: 404 })).toBe("error");
  });
});
