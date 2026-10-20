import type { Metadata } from "next";
import Link from "next/link";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { TabLink } from "@/components/tab-link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import {
  demoPeriods,
  formatHoursValue,
  hrefWith,
  isCombined,
  PERIOD_KEYS,
  parsePage,
  parsePeriod,
  scopeParams,
  workshopArg,
} from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { formatDateOnly, formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Part-wait per bike · Vutto Parts" };

const PAGE_SIZE = 100;

/** The list behind the part-wait tile (SPEC §10): part_waits() for one period, footer from kpis(). */
export default async function PartWaitPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { profile, workshop, workshops } = await requireRole("/metrics/part-wait", sp);
  const t = await getT();
  const supabase = await createClient();
  const combined = isCombined(profile.role, sp.scope);
  const scope = scopeParams(profile.role, workshop.code, combined);
  const periodKey = parsePeriod(sp.period);
  const waitingOnly = sp.waiting === "1";
  const page = parsePage(sp.page);

  const meta = await supabase.from("demo_meta").select("anchor_date").maybeSingle();
  if (meta.error) throw meta.error;
  const anchor = meta.data?.anchor_date ?? null;
  const header = (
    <PageHeader
      title={t("pages.partWait")}
      subtitle={
        <span className="flex flex-wrap gap-x-2">
          <span>{combined ? t("metrics.combined") : `${workshop.name} (${workshop.code})`}</span>
          <AsOf />
        </span>
      }
    />
  );
  if (!anchor) {
    return (
      <>
        {header}
        <EmptyState message={t("metrics.noAnchor")} />
      </>
    );
  }

  const period = demoPeriods(anchor)[periodKey];
  const args = { p_workshop_id: workshopArg(combined ? null : workshop.id), p_from: period.from, p_to: period.to };
  let list = supabase.rpc("part_waits", args, { count: "exact" });
  if (waitingOnly) list = list.eq("still_waiting", true);
  const from = (page - 1) * PAGE_SIZE;
  const [listRes, kpiRes] = await Promise.all([
    list.order("started_at").order("bike_id").range(from, from + PAGE_SIZE - 1),
    supabase.rpc("kpis", args),
  ]);
  if (listRes.error) throw listRes.error;
  if (kpiRes.error) throw kpiRes.error;
  const rows = listRes.data ?? [];
  const k = kpiRes.data[0];
  const pages = Math.max(1, Math.ceil((listRes.count ?? 0) / PAGE_SIZE));
  const codeOf = new Map(workshops.map((w) => [w.id, w.code]));

  const self = (params: Record<string, string | undefined>) =>
    hrefWith("/metrics/part-wait", { period: periodKey, waiting: waitingOnly ? "1" : undefined, ...scope, ...params });

  return (
    <>
      {header}
      <nav className="mb-2 flex flex-wrap gap-1" aria-label={t("metrics.periodTabs")}>
        {PERIOD_KEYS.map((key) => (
          <TabLink key={key} href={self({ period: key, page: undefined })} active={key === periodKey}>
            {t(`metrics.${key}`)}
          </TabLink>
        ))}
        <span className="mx-1" />
        <TabLink href={self({ waiting: undefined, page: undefined })} active={!waitingOnly}>
          {t("metrics.allBikes")}
        </TabLink>
        <TabLink href={self({ waiting: "1", page: undefined })} active={waitingOnly}>
          {t("metrics.waitingOnly")}
        </TabLink>
      </nav>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {t("metrics.periodIntro", {
          period: t(`metrics.${periodKey}`),
          from: formatDateOnly(period.from),
          to: formatDateOnly(period.to),
        })}
        <Badge variant="outline">{t("metrics.simulated")}</Badge>
      </p>

      {rows.length === 0 ? (
        <EmptyState message={t("metrics.partWaitEmpty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table data-testid="part-wait-list">
            <TableHeader>
              <TableRow>
                {combined && <TableHead>{t("metrics.workshop")}</TableHead>}
                <TableHead>{t("metrics.bike")}</TableHead>
                <TableHead>{t("metrics.started")}</TableHead>
                <TableHead>{t("metrics.ended")}</TableHead>
                <TableHead className="text-right">{t("metrics.wait")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const code = codeOf.get(r.workshop_id) ?? workshop.code;
                return (
                  <TableRow key={r.job_card_id}>
                    {combined && <TableCell className="font-mono">{code}</TableCell>}
                    <TableCell>
                      <span className="font-mono">{r.reg_no}</span>
                      <Link
                        href={hrefWith(`/job-cards/${r.job_card_id}`, profile.role === "admin" ? { ws: code } : {})}
                        className="block font-mono text-xs underline underline-offset-4"
                      >
                        {r.card_code}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatIST(r.started_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.still_waiting ? <Badge variant="destructive">{t("metrics.stillWaitingBadge")}</Badge> : formatIST(r.ended_at)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatHoursValue(r.wait_hours)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={page} pages={pages} hrefFor={(p) => self({ page: String(p) })} />
      <p className="mt-3 text-sm font-medium" data-testid="part-wait-footer">
        {t("metrics.partWaitFooter", {
          n: k.wait_n,
          median: formatHoursValue(k.wait_median_hours),
          p90: formatHoursValue(k.wait_p90_hours),
          waiting: k.wait_still_waiting_n,
        })}
      </p>
    </>
  );
}
