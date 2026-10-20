// Metrics page helpers (SPEC §10, §15). The numbers come from SQL (kpis, part_waits, …); this
// module only picks the simulated periods, builds links and formats values for display.
import { addDaysIST } from "@/lib/time";

export const PERIOD_KEYS = ["before", "after"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export type Period = { key: PeriodKey; from: string; to: string };

/**
 * The simulated story (SPEC §15) relative to the demo anchor: "before" is days −90..−46 (job cards
 * confirmed at bay-in), "after" is days −45..−1 (confirmed at purchase). Pre-ordering started on
 * the first "after" day.
 */
export function demoPeriods(anchor: string): Record<PeriodKey, Period> & { preOrderingStarted: string } {
  return {
    before: { key: "before", from: addDaysIST(anchor, -90), to: addDaysIST(anchor, -46) },
    after: { key: "after", from: addDaysIST(anchor, -45), to: addDaysIST(anchor, -1) },
    preOrderingStarted: addDaysIST(anchor, -45),
  };
}

/** ?period=before|after; anything else is "after". */
export function parsePeriod(value: unknown): PeriodKey {
  return value === "before" ? "before" : "after";
}

/** ?page=N (1-based); anything else is 1. */
export function parsePage(value: unknown): number {
  const n = typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : 1;
  return n >= 1 ? n : 1;
}

/**
 * The report functions take p_workshop_id null = every workshop the caller can see (admin:
 * combined, pooled in SQL). The generated types mark the argument non-null.
 */
export function workshopArg(id: string | null): string {
  return id as string;
}

/** A path with query parameters; undefined values are left out. */
export function hrefWith(path: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** A ratio from SQL (0.123) as "12.3%"; null (nullif denominator) as "–". signed adds "+". */
export function formatPct(ratio: number | string | null, opts: { signed?: boolean } = {}): string {
  if (ratio === null) return "–";
  const pct = Number(ratio) * 100;
  const text = `${pct.toFixed(1)}%`;
  return opts.signed && pct > 0 ? `+${text}` : text;
}

/** Hours from SQL as "12.5 h"; null as "–". */
export function formatHoursValue(hours: number | string | null): string {
  if (hours === null) return "–";
  return `${Number(hours).toFixed(1)} h`;
}

/** The reset banner shows for 1 hour after a demo reset (Prompt 13). */
export const RESET_BANNER_MS = 60 * 60 * 1000;

export function isRecentReset(lastResetAt: string | null, nowMs: number): boolean {
  if (!lastResetAt) return false;
  const at = new Date(lastResetAt).getTime();
  return Number.isFinite(at) && nowMs - at < RESET_BANNER_MS;
}

/** Admin's Combined view is ?scope=all (both workshops pooled in SQL); everyone else sees one. */
export function isCombined(role: string, scope: unknown): boolean {
  return role === "admin" && scope === "all";
}

/** The URL parameters that keep the metrics scope on links: scope=all, the admin's ws, or none. */
export function scopeParams(role: string, workshopCode: string, combined: boolean): Record<string, string | undefined> {
  if (combined) return { scope: "all" };
  return role === "admin" ? { ws: workshopCode } : {};
}
