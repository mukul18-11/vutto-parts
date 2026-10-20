// All "day" logic is Asia/Kolkata (SPEC §13). Date-only values are 'YYYY-MM-DD' strings;
// never build a Date from one (new Date('YYYY-MM-DD') is UTC midnight, not an IST day).

import type { TFunction } from "@/lib/i18n";

const IST = "Asia/Kolkata";

// en-CA formats as YYYY-MM-DD.
const istDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const istDateTimeParts = new Intl.DateTimeFormat("en-US", {
  timeZone: IST,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Today's date in IST as 'YYYY-MM-DD'. */
export function istToday(): string {
  return istDate.format(new Date());
}

/** Absolute IST time such as "18 Oct, 11:42". Takes a timestamptz string or a Date. */
export function formatIST(ts: string | Date): string {
  const parts = istDateTimeParts.formatToParts(typeof ts === "string" ? new Date(ts) : ts);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part("day")} ${part("month")}, ${part("hour")}:${part("minute")}`;
}

/** IST clock time such as "11:42" (for "as of HH:MM IST"). */
export function formatISTTime(ts: string | Date): string {
  const parts = istDateTimeParts.formatToParts(typeof ts === "string" ? new Date(ts) : ts);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part("hour")}:${part("minute")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A date-only 'YYYY-MM-DD' value as "20 Oct 2026", read from the string (never new Date(str)). */
export function formatDateOnly(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) throw new RangeError(`formatDateOnly expects YYYY-MM-DD, got ${date}`);
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/**
 * Elapsed time from a timestamptz to now as "3d 4h", "5h 12m" or "8m" (never negative), in the
 * user's language. nowMs is passed in so a server component renders one consistent value.
 */
export function formatDuration(from: string | Date, nowMs: number, t: TFunction): string {
  const start = (typeof from === "string" ? new Date(from) : from).getTime();
  const minutes = Math.max(0, Math.floor((nowMs - start) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  if (d > 0) return t("time.daysHours", { d, h });
  if (h > 0) return t("time.hoursMinutes", { h, m: minutes % 60 });
  return t("time.minutes", { m: minutes });
}

/** The request's clock for server components that show "waiting 3d 4h" (rendered once per request). */
export function requestNow(): number {
  return Date.now();
}

/** Hours (numeric from SQL, possibly a string) as a duration: 50.5 → "2d 2h". */
export function formatHours(hours: number | string, t: TFunction): string {
  const minutes = Math.max(0, Math.round(Number(hours) * 60));
  return formatDuration(new Date(0), minutes * 60_000, t);
}

/** 'YYYY-MM-DD' plus n calendar days, computed on the date parts (never new Date(str)). */
export function addDaysIST(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`addDaysIST expects YYYY-MM-DD, got ${date}`);
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
