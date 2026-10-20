// Pure calendar math for the seed generator (SPEC §15: no Date, Math.random or Intl).
// A time is an integer number of minutes relative to 00:00 IST on the template anchor day
// (T0 + 90). Day d (d < 0 for the past) starts at d * 1440. All seeded events fall on days
// −180..−1 between 09:30 and 19:00 IST; planned dates may be day 0 (today) or later.

/** Template day 0 of the 90-day window (a Monday). The template anchor is T0 + 90. */
export const T0 = { y: 2026, m: 1, d: 5 } as const;
export const SIM_DAYS = 90;
export const OPENING_DAY = -180;
export const DAY_START = 9 * 60 + 30;
export const DAY_END = 19 * 60;

// Howard Hinnant's days_from_civil / civil_from_days (proleptic Gregorian, integer only).
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

const ANCHOR_EPOCH_DAY = daysFromCivil(T0.y, T0.m, T0.d) + SIM_DAYS;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 'YYYY-MM-DD' of a day offset from the anchor. */
export function dateStr(day: number): string {
  const c = civilFromDays(ANCHOR_EPOCH_DAY + day);
  return `${pad(c.y, 4)}-${pad(c.m)}-${pad(c.d)}`;
}

export const ANCHOR_DATE = dateStr(0);

/** IST day offset of a time. */
export function dayOf(t: number): number {
  return Math.floor(t / 1440);
}

export function at(day: number, minute: number): number {
  return day * 1440 + minute;
}

/** timestamptz literal in IST. */
export function tsStr(t: number): string {
  const day = dayOf(t);
  const min = t - day * 1440;
  return `${dateStr(day)} ${pad(Math.floor(min / 60))}:${pad(min % 60)}:00+05:30`;
}

/** 0 = Sunday … 6 = Saturday (1970-01-01, epoch day 0, was a Thursday). */
export function weekday(day: number): number {
  return (((ANCHOR_EPOCH_DAY + day + 4) % 7) + 7) % 7;
}

export function isSunday(day: number): boolean {
  return weekday(day) === 0;
}
