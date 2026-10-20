import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDateOnly, formatIST, formatISTTime, istToday } from "@/lib/time";

afterEach(() => {
  vi.useRealTimers();
});

it("runs in a non-IST time zone (pnpm test sets TZ=America/Los_Angeles)", () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
});

describe("istToday", () => {
  it("is already the next day at 00:10 IST, which is still the previous UTC day", () => {
    // 2026-10-19 18:40 UTC = 2026-10-20 00:10 IST (and 11:40 on the 19th in Los Angeles).
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 19, 18, 40) });
    expect(istToday()).toBe("2026-10-20");
  });

  it("is still the same day at 23:59 IST", () => {
    // 2026-10-19 18:29 UTC = 2026-10-19 23:59 IST.
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 19, 18, 29) });
    expect(istToday()).toBe("2026-10-19");
  });
});

describe("formatIST", () => {
  it("formats a timestamptz string as absolute IST", () => {
    expect(formatIST("2026-10-18T06:12:00+00:00")).toBe("18 Oct, 11:42");
  });

  it("uses the IST date and a 24-hour clock across midnight", () => {
    expect(formatIST(new Date(Date.UTC(2026, 9, 19, 18, 40)))).toBe("20 Oct, 00:10");
  });
});

describe("formatISTTime", () => {
  it("shows the IST clock time", () => {
    expect(formatISTTime("2026-10-18T06:12:00+00:00")).toBe("11:42");
    expect(formatISTTime(new Date(Date.UTC(2026, 9, 19, 18, 40)))).toBe("00:10");
  });
});

describe("formatDateOnly", () => {
  it("formats a date-only string without a time zone shift", () => {
    expect(formatDateOnly("2026-10-20")).toBe("20 Oct 2026");
    expect(formatDateOnly("2026-01-01")).toBe("1 Jan 2026");
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(() => formatDateOnly("2026-13-01")).toThrow(RangeError);
    expect(() => formatDateOnly("20 Oct")).toThrow(RangeError);
  });
});
