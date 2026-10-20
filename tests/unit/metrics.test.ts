// Metrics helpers (Prompt 13): the simulated periods from the anchor (SPEC §15), display formats,
// scope links and the reset banner window. Runs with TZ=America/Los_Angeles.
import { describe, expect, it } from "vitest";
import {
  demoPeriods,
  formatHoursValue,
  formatPct,
  hrefWith,
  isCombined,
  isRecentReset,
  parsePage,
  parsePeriod,
  scopeParams,
} from "@/lib/metrics";

describe("demoPeriods", () => {
  it("splits days −90..−46 and −45..−1 around the anchor, pre-ordering from day −45", () => {
    const p = demoPeriods("2026-10-21");
    expect(p.before).toEqual({ key: "before", from: "2026-07-23", to: "2026-09-05" });
    expect(p.after).toEqual({ key: "after", from: "2026-09-06", to: "2026-10-20" });
    expect(p.preOrderingStarted).toBe("2026-09-06");
  });

  it("crosses a year boundary on the date parts", () => {
    const p = demoPeriods("2026-01-15");
    expect(p.before.from).toBe("2025-10-17");
    expect(p.after.to).toBe("2026-01-14");
  });
});

describe("URL parameters", () => {
  it("period defaults to after", () => {
    expect(parsePeriod("before")).toBe("before");
    expect(parsePeriod("after")).toBe("after");
    expect(parsePeriod(undefined)).toBe("after");
    expect(parsePeriod(["before"])).toBe("after");
  });

  it("page is a positive integer, else 1", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("1e3")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });

  it("Combined is admin only", () => {
    expect(isCombined("admin", "all")).toBe(true);
    expect(isCombined("manager", "all")).toBe(false);
    expect(isCombined("admin", undefined)).toBe(false);
  });

  it("links keep the scope", () => {
    expect(scopeParams("admin", "JPR", true)).toEqual({ scope: "all" });
    expect(scopeParams("admin", "JPR", false)).toEqual({ ws: "JPR" });
    expect(scopeParams("manager", "NCR", false)).toEqual({});
    expect(hrefWith("/metrics/part-wait", { period: "before", waiting: undefined, ws: "JPR" })).toBe(
      "/metrics/part-wait?period=before&ws=JPR",
    );
    expect(hrefWith("/dead-stock", {})).toBe("/dead-stock");
  });
});

describe("formats", () => {
  it("ratios as percent, null as –", () => {
    expect(formatPct(0.1234)).toBe("12.3%");
    expect(formatPct(0)).toBe("0.0%");
    expect(formatPct("0.5")).toBe("50.0%");
    expect(formatPct(null)).toBe("–");
    expect(formatPct(0.25, { signed: true })).toBe("+25.0%");
    expect(formatPct(-0.04, { signed: true })).toBe("-4.0%");
  });

  it("hours with one decimal, null as –", () => {
    expect(formatHoursValue(12.345)).toBe("12.3 h");
    expect(formatHoursValue("0")).toBe("0.0 h");
    expect(formatHoursValue(null)).toBe("–");
  });
});

describe("isRecentReset", () => {
  const at = "2026-10-21T05:32:00Z"; // 11:02 IST
  const ms = Date.parse(at);

  it("is true for under an hour after the reset", () => {
    expect(isRecentReset(at, ms)).toBe(true);
    expect(isRecentReset(at, ms + 59 * 60_000)).toBe(true);
  });

  it("is false from one hour on, and without a reset", () => {
    expect(isRecentReset(at, ms + 60 * 60_000)).toBe(false);
    expect(isRecentReset(null, ms)).toBe(false);
    expect(isRecentReset("not a time", ms)).toBe(false);
  });
});
