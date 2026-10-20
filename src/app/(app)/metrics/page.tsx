import type { Metadata } from "next";
import Link from "next/link";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TabLink } from "@/components/tab-link";
import { Badge } from "@/components/ui/badge";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import type { TFunction } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import {
  demoPeriods,
  formatHoursValue,
  formatPct,
  hrefWith,
  isCombined,
  PERIOD_KEYS,
  scopeParams,
  workshopArg,
  type Period,
  type PeriodKey,
} from "@/lib/metrics";
import { formatINR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatDateOnly } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Metrics · Vutto Parts" };

type Kpis = Database["public"]["Functions"]["kpis"]["Returns"][number];

/**
 * Metrics (SPEC §10): the part-wait north star and supporting figures, before vs after pre-ordering
 * in the simulated history (SPEC §15). kpi_weekly was skipped (Prompt 7), so there is no trend
 * chart: two kpis() calls side by side. Admin sees NCR, JPR and Combined (pooled in SQL).
 */
export default async function MetricsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { profile, workshop, workshops } = await requireRole("/metrics", sp);
  const t = await getT();
  const supabase = await createClient();
  const isAdmin = profile.role === "admin";
  const combined = isCombined(profile.role, sp.scope);
  const scope = scopeParams(profile.role, workshop.code, combined);

  const meta = await supabase.from("demo_meta").select("anchor_date").maybeSingle();
  if (meta.error) throw meta.error;
  const anchor = meta.data?.anchor_date ?? null;

  const header = (
    <PageHeader
      title={t("pages.metrics")}
      subtitle={
        <span className="flex flex-wrap gap-x-2">
          <span>{combined ? t("metrics.combined") : `${workshop.name} (${workshop.code})`}</span>
          <AsOf />
        </span>
      }
    />
  );
  const scopeTabs = isAdmin && (
    <nav className="mb-4 flex flex-wrap gap-1" aria-label={t("metrics.scopeTabs")}>
      {workshops.map((w) => (
        <TabLink key={w.id} href={withWs("/metrics", "admin", w.code)} active={!combined && w.id === workshop.id}>
          {w.code}
        </TabLink>
      ))}
      <TabLink href="/metrics?scope=all" active={combined}>
        {t("metrics.combined")}
      </TabLink>
    </nav>
  );

  if (!anchor) {
    return (
      <>
        {header}
        {scopeTabs}
        <EmptyState message={t("metrics.noAnchor")} />
      </>
    );
  }

  const periods = demoPeriods(anchor);
  const results = await Promise.all(
    PERIOD_KEYS.map((key) =>
      supabase.rpc("kpis", {
        p_workshop_id: workshopArg(combined ? null : workshop.id),
        p_from: periods[key].from,
        p_to: periods[key].to,
      }),
    ),
  );
  const k = {} as Record<PeriodKey, Kpis>;
  PERIOD_KEYS.forEach((key, i) => {
    const res = results[i];
    if (res.error) throw res.error;
    k[key] = res.data[0];
  });
  // Dead stock and overdue POs are as of today: the same in both calls.
  const now = k.after;

  const periodHref = (path: string, key: PeriodKey) => hrefWith(path, { period: key, ...scope });
  // Lists that are per workshop: in the Combined view, link each workshop's list.
  const workshopLinks = (path: string, label: string, params: Record<string, string> = {}) =>
    combined
      ? workshops.map((w) => ({ href: hrefWith(path, { ...params, ws: w.code }), label: `${label} · ${w.code}` }))
      : [{ href: hrefWith(path, { ...params, ...scope }), label }];

  return (
    <>
      {header}
      {scopeTabs}
      <p className="mb-4 text-sm text-muted-foreground">{t("metrics.intro")}</p>

      <section className="mb-4 rounded-xl border p-4" data-testid="north-star" aria-labelledby="north-star-title">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="north-star-title" className="text-lg font-semibold">
            {t("metrics.northStar")}
          </h2>
          <Badge variant="outline" data-testid="simulated-badge">
            {t("metrics.simulated")}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("metrics.northStarDef")}</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2 md:gap-0">
          {PERIOD_KEYS.map((key) => (
            <div
              key={key}
              className={cn(
                "flex flex-col gap-2",
                key === "before" ? "md:pt-6 md:pr-4" : "relative border-t-2 border-dashed border-primary pt-6 md:border-t-0 md:border-l-2 md:pt-6 md:pl-4",
              )}
              data-testid={`wait-${key}`}
            >
              {key === "after" && (
                <p className="absolute -top-3 left-2 bg-background px-1 text-xs font-medium text-primary md:top-0" data-testid="pre-ordering-marker">
                  {t("metrics.marker", { date: formatDateOnly(periods.preOrderingStarted) })} · {t("metrics.simulated")}
                </p>
              )}
              <PeriodHeading t={t} period={periods[key]} />
              <WaitFigures t={t} k={k[key]} period={key} />
              <Link href={periodHref("/metrics/part-wait", key)} className="text-sm font-medium underline underline-offset-4">
                {t("metrics.seeBikes")}
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("metrics.markerNote")}</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard
          title={t("metrics.emergencyShare")}
          definition={t("metrics.emergencyShareDef")}
          testId="emergency"
          links={PERIOD_KEYS.flatMap((key) =>
            workshopLinks("/emergency", `${t("metrics.seeBuys")} (${t(`metrics.${key}`)})`, { from: periods[key].from, to: periods[key].to }),
          )}
        >
          <PeriodPair
            t={t}
            render={(key) => {
              const row = k[key];
              const spend = Number(row.emergency_spend_paise);
              return (
                <>
                  <Big testId={`emergency-share-${key}`}>{formatPct(row.emergency_share)}</Big>
                  <Small>{t("metrics.emergencyAmounts", { spend: formatINR(spend), total: formatINR(spend + Number(row.grn_value_paise)) })}</Small>
                  <Small testId={`emergency-premium-${key}`}>{t("metrics.premium", { pct: formatPct(row.emergency_premium, { signed: true }) })}</Small>
                  {row.emergency_without_reference_n > 0 && <Small>{t("metrics.withoutReference", { n: row.emergency_without_reference_n })}</Small>}
                </>
              );
            }}
          />
        </MetricCard>

        <MetricCard
          title={t("metrics.wrongFit")}
          definition={t("metrics.wrongFitDef")}
          testId="wrong-fit"
          links={PERIOD_KEYS.map((key) => ({ href: periodHref("/metrics/wrong-fit", key), label: `${t("metrics.seeReturns")} (${t(`metrics.${key}`)})` }))}
        >
          <PeriodPair
            t={t}
            render={(key) => (
              <>
                <Big testId={`wrong-fit-${key}`}>{formatPct(k[key].wrong_fit_rate)}</Big>
                <Small>{t("metrics.wrongFitQty", { qty: k[key].wrong_fit_qty, issued: k[key].issued_qty })}</Small>
              </>
            )}
          />
        </MetricCard>

        <MetricCard
          title={t("metrics.deadStock")}
          definition={t("metrics.deadStockDef")}
          testId="dead-stock"
          links={workshopLinks("/dead-stock", t("metrics.seeDeadStock"))}
        >
          <Small>{t("metrics.now")}</Small>
          <Big testId="dead-stock-value">{formatINR(Number(now.dead_stock_value_paise))}</Big>
          <Small>{t("metrics.deadStockSkus", { n: now.dead_stock_sku_n })}</Small>
        </MetricCard>

        <MetricCard
          title={t("metrics.overduePos")}
          definition={t("metrics.overduePosDef")}
          testId="overdue-pos"
          links={workshopLinks("/purchasing", t("metrics.seePos"), { tab: "sent" })}
        >
          <Small>{t("metrics.now")}</Small>
          <Big testId="overdue-pos-n" danger={now.po_overdue_n > 0}>
            {String(now.po_overdue_n)}
          </Big>
        </MetricCard>
      </div>
    </>
  );
}

function PeriodHeading({ t, period }: { t: TFunction; period: Period }) {
  return (
    <h3 className="text-sm font-semibold">
      {t(`metrics.${period.key}`)}{" "}
      <span className="font-normal text-muted-foreground">
        {t("metrics.range", { from: formatDateOnly(period.from), to: formatDateOnly(period.to) })}
      </span>
    </h3>
  );
}

/** Median, p90, % zero wait and n; "–" and "n=3, too few" when n < 5 (SPEC §10). */
function WaitFigures({ t, k, period }: { t: TFunction; k: Kpis; period: PeriodKey }) {
  const tooFew = k.wait_n < 5;
  return (
    <>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label={t("metrics.median")} value={formatHoursValue(k.wait_median_hours)} testId={`wait-median-${period}`} strong />
        <Figure label={t("metrics.p90")} value={formatHoursValue(k.wait_p90_hours)} testId={`wait-p90-${period}`} />
        <Figure label={t("metrics.zeroWait")} value={formatPct(k.wait_zero_pct)} testId={`wait-zero-${period}`} />
        <Figure label={t("metrics.bikes")} value={`n=${k.wait_n}`} testId={`wait-n-${period}`} />
      </dl>
      {tooFew && <Small testId={`wait-too-few-${period}`}>{t("metrics.tooFew", { n: k.wait_n })}</Small>}
      {k.wait_still_waiting_n > 0 && (
        <Small testId={`wait-still-${period}`}>
          {t("metrics.stillWaiting", { n: k.wait_still_waiting_n, hours: formatHoursValue(k.wait_still_waiting_avg_hours) })}
        </Small>
      )}
    </>
  );
}

function Figure({ label, value, testId, strong }: { label: string; value: string; testId: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-2xl font-semibold" : "text-lg font-medium")} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function MetricCard({
  title,
  definition,
  links,
  testId,
  children,
}: {
  title: string;
  definition: string;
  links: { href: string; label: string }[];
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border p-4" data-testid={`card-${testId}`}>
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{definition}</p>
      <div className="flex flex-col gap-1">{children}</div>
      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-sm font-medium underline underline-offset-4">
            {l.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Before | After side by side; the dashed line marks when pre-ordering started. */
function PeriodPair({ t, render }: { t: TFunction; render: (key: PeriodKey) => React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {PERIOD_KEYS.map((key) => (
        <div key={key} className={cn("flex min-w-0 flex-col gap-1", key === "after" && "border-l-2 border-dashed border-primary pl-3")}>
          <h3 className="text-sm font-semibold">{t(`metrics.${key}`)}</h3>
          {render(key)}
        </div>
      ))}
    </div>
  );
}

function Big({ children, testId, danger }: { children: React.ReactNode; testId?: string; danger?: boolean }) {
  return (
    <p className={cn("text-2xl font-semibold tabular-nums", danger && "text-red-700 dark:text-red-400")} data-testid={testId}>
      {children}
    </p>
  );
}

function Small({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid={testId}>
      {children}
    </p>
  );
}
