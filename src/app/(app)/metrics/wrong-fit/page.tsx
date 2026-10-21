import type { Metadata } from "next";
import Link from "next/link";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TabLink } from "@/components/tab-link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDemoMeta, requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { demoPeriods, formatPct, hrefWith, isCombined, PERIOD_KEYS, parsePeriod, scopeParams, workshopArg } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { formatDateOnly, formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Wrong-fit returns · Vutto Parts" };

type Uom = Database["public"]["Enums"]["uom"];
const LIMIT = 500;

/** The list behind the wrong-fit rate (SPEC §10): wrong_fit_returns() for one period, footer from kpis(). */
export default async function WrongFitPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const [{ profile, workshop, workshops }, demoMeta] = await Promise.all([requireRole("/metrics/wrong-fit", sp), getDemoMeta()]);
  const t = await getT();
  const supabase = await createClient();
  const combined = isCombined(profile.role, sp.scope);
  const scope = scopeParams(profile.role, workshop.code, combined);
  const periodKey = parsePeriod(sp.period);

  const anchor = demoMeta?.anchor_date ?? null;
  const header = (
    <PageHeader
      title={t("pages.wrongFit")}
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
  const [listRes, kpiRes] = await Promise.all([
    supabase.rpc("wrong_fit_returns", args).limit(LIMIT),
    supabase.rpc("kpis", args),
  ]);
  if (listRes.error) throw listRes.error;
  if (kpiRes.error) throw kpiRes.error;
  const rows = listRes.data ?? [];
  const k = kpiRes.data[0];
  const codeOf = new Map(workshops.map((w) => [w.id, w.code]));

  return (
    <>
      {header}
      <nav className="mb-2 flex flex-wrap gap-1" aria-label={t("metrics.periodTabs")}>
        {PERIOD_KEYS.map((key) => (
          <TabLink key={key} href={hrefWith("/metrics/wrong-fit", { period: key, ...scope })} active={key === periodKey}>
            {t(`metrics.${key}`)}
          </TabLink>
        ))}
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
        <EmptyState message={t("metrics.wrongFitEmpty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table data-testid="wrong-fit-list">
            <TableHeader>
              <TableRow>
                {combined && <TableHead>{t("metrics.workshop")}</TableHead>}
                <TableHead>{t("metrics.date")}</TableHead>
                <TableHead>{t("metrics.bike")}</TableHead>
                <TableHead>{t("metrics.part")}</TableHead>
                <TableHead className="text-right">{t("metrics.qty")}</TableHead>
                <TableHead>{t("metrics.note")}</TableHead>
                <TableHead>{t("metrics.by")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const code = codeOf.get(r.workshop_id) ?? workshop.code;
                return (
                  <TableRow key={r.move_id}>
                    {combined && <TableCell className="font-mono">{code}</TableCell>}
                    <TableCell className="whitespace-nowrap">{formatIST(r.created_at)}</TableCell>
                    <TableCell>
                      <span className="font-mono">{r.reg_no}</span>
                      {r.job_card_id && (
                        <Link
                          href={hrefWith(`/job-cards/${r.job_card_id}`, profile.role === "admin" ? { ws: code } : {})}
                          className="block font-mono text-xs underline underline-offset-4"
                        >
                          {r.card_code}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{r.sku}</span>
                      <span className="block">{r.part_name}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{`${r.qty} ${t(`enums.uom.${r.uom as Uom}`)}`}</TableCell>
                    <TableCell className="min-w-48 max-w-64 whitespace-normal break-words">{r.note}</TableCell>
                    <TableCell>{r.user_name}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {rows.length === LIMIT && <p className="mt-3 text-sm text-muted-foreground">{t("metrics.limited", { n: LIMIT })}</p>}
      <p className="mt-3 text-sm font-medium" data-testid="wrong-fit-footer">
        {t("metrics.wrongFitFooter", { qty: k.wrong_fit_qty, issued: k.issued_qty, rate: formatPct(k.wrong_fit_rate) })}
      </p>
    </>
  );
}
