// All "day" logic is Asia/Kolkata (SPEC §13). Date-only values are 'YYYY-MM-DD' strings;
// never build a Date from one (new Date('YYYY-MM-DD') is UTC midnight, not an IST day).

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
