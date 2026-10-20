import { describe, expect, it } from "vitest";
import { isServerActionMissing, loginUrl, nextStep, type RpcResult } from "@/lib/rpc-form-logic";

const fail = (code: Extract<RpcResult<never>, { ok: false }>["code"]): RpcResult<never> => ({
  ok: false,
  code,
  message: "x",
});

describe("nextStep", () => {
  it("renews the request_id only after success", () => {
    expect(nextStep({ ok: true, data: {} })).toEqual({
      renewRequestId: true,
      refresh: false,
      redirectToLogin: false,
      earlierSaved: false,
    });
    for (const code of ["VALIDATION", "NOT_FOUND", "UNKNOWN", "SESSION_CHANGED", "OVER_RECEIPT"] as const) {
      expect(nextStep(fail(code)).renewRequestId, code).toBe(false);
    }
  });

  it("sends SESSION_EXPIRED to login", () => {
    expect(nextStep(fail("SESSION_EXPIRED"))).toMatchObject({ redirectToLogin: true, renewRequestId: false });
  });

  it.each(["INSUFFICIENT_RESERVATION", "INSUFFICIENT_BIN_STOCK", "STALE_COUNT"] as const)(
    "refreshes the screen on %s",
    (code) => {
      expect(nextStep(fail(code))).toMatchObject({ refresh: true, renewRequestId: false, earlierSaved: false });
    },
  );

  it("treats IDEMPOTENCY_KEY_REUSED as an earlier save: refresh and renew", () => {
    expect(nextStep(fail("IDEMPOTENCY_KEY_REUSED"))).toEqual({
      renewRequestId: true,
      refresh: true,
      redirectToLogin: false,
      earlierSaved: true,
    });
  });

  it("does nothing extra for other coded errors", () => {
    expect(nextStep(fail("OVER_RECEIPT"))).toEqual({
      renewRequestId: false,
      refresh: false,
      redirectToLogin: false,
      earlierSaved: false,
    });
  });
});

describe("helpers", () => {
  it("detects a stale server action after a deploy", () => {
    expect(isServerActionMissing(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.'))).toBe(true);
    expect(isServerActionMissing(new TypeError("Failed to fetch"))).toBe(false);
    expect(isServerActionMissing(null)).toBe(false);
  });

  it("builds a login URL that returns to the current page", () => {
    expect(loginUrl("/store?ws=JPR")).toBe("/login?next=%2Fstore%3Fws%3DJPR");
  });
});
