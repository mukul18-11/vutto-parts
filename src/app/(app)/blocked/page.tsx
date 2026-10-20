import type { Metadata } from "next";
import Link from "next/link";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import type { TFunction } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { formatINR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatDateOnly, formatDuration, formatHours, formatIST, requestNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { EtaBadge, type Eta } from "@/components/eta-badge";
import { GeneratePosButton } from "./generate-pos-button";

export const metadata: Metadata = { title: "Blocked bikes · Vutto Parts" };

type Uom = Database["public"]["Enums"]["uom"];
type BikeStatus = Database["public"]["Enums"]["bike_status"];

/** One entry of v_blocked_bikes.missing_parts / v_inbound_shortfalls.missing_parts. */
type MissingPart = Eta & {
  line_id: string;
  sku: string;
  name: string;
  uom: Uom;
  uncovered: number;
  reallocation_candidates: { line_id: string; card_code: string; reg_no: string; qty_reserved: number }[];
};

type BoardRow = {
  bike_id: string;
  reg_no: string;
  make: string;
  model: string;
  variant_name: string | null;
  mfg_year: number;
  bike_status: BikeStatus;
  job_card_id: string;
  card_code: string;
  needs_review_reason: string | null;
  missing_parts: MissingPart[];
  since: string;
};

const BOARD_LIMIT = 500;

export default async function BlockedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { user, profile, workshop } = await requireRole("/blocked", sp);
  const t = await getT();
  const supabase = await createClient();
  const tab = sp.tab === "inbound" ? "inbound" : "blocked";
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const [kpiRes, blockedRes, inboundRes] = await Promise.all([
    supabase.rpc("blocked_board_kpis", { p_workshop_id: workshop.id }),
    supabase
      .from("v_blocked_bikes")
      .select(
        "bike_id, reg_no, make, model, variant_name, mfg_year, bike_status, job_card_id, card_code, needs_review_reason, missing_parts, waiting_since",
        { count: "exact" },
      )
      .eq("workshop_id", workshop.id)
      .order("waiting_since", { ascending: true })
      .order("job_card_id")
      .limit(tab === "blocked" ? BOARD_LIMIT : 0),
    supabase
      .from("v_inbound_shortfalls")
      .select(
        "bike_id, reg_no, make, model, variant_name, mfg_year, bike_status, job_card_id, card_code, needs_review_reason, missing_parts, purchased_at",
        { count: "exact" },
      )
      .eq("workshop_id", workshop.id)
      .order("purchased_at", { ascending: true })
      .order("job_card_id")
      .limit(tab === "inbound" ? BOARD_LIMIT : 0),
  ]);
  if (kpiRes.error) throw kpiRes.error;
  if (blockedRes.error) throw blockedRes.error;
  if (inboundRes.error) throw inboundRes.error;

  const kpi = kpiRes.data[0];
  // View columns are typed nullable; the board views never return nulls in these columns.
  type Raw = Omit<BoardRow, "since" | "missing_parts"> & { missing_parts: unknown };
  const rows: BoardRow[] =
    tab === "blocked"
      ? (blockedRes.data as (Raw & { waiting_since: string })[]).map((r) => ({
          ...r,
          since: r.waiting_since,
          missing_parts: r.missing_parts as MissingPart[],
        }))
      : (inboundRes.data as (Raw & { purchased_at: string })[]).map((r) => ({
          ...r,
          since: r.purchased_at,
          missing_parts: r.missing_parts as MissingPart[],
        }));
  const now = requestNow();

  return (
    <>
      <PageHeader
        title={t("pages.blocked")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
        actions={<GeneratePosButton userId={user.id} workshopId={workshop.id} />}
      />

      <section aria-label={t("blocked.kpis")} className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label={t("blocked.kpiBlocked")} value={String(kpi.blocked_n)} testId="kpi-blocked" />
        <Kpi
          label={t("blocked.kpiAvgWait")}
          value={kpi.avg_wait_hours === null ? "–" : formatHours(kpi.avg_wait_hours, t)}
        />
        <Kpi
          label={t("blocked.kpiEmergency", { date: formatDateOnly(kpi.week_start) })}
          value={String(kpi.emergency_week_n)}
          sub={formatINR(Number(kpi.emergency_week_paise))}
        />
        <Kpi label={t("blocked.kpiOverduePos")} value={String(kpi.po_overdue_n)} danger={kpi.po_overdue_n > 0} />
      </section>

      <nav className="mb-3 flex gap-1" aria-label={t("blocked.tabs")}>
        <TabLink href={link("/blocked")} active={tab === "blocked"}>
          {t("blocked.tabBlocked", { n: blockedRes.count ?? 0 })}
        </TabLink>
        <TabLink href={link("/blocked?tab=inbound")} active={tab === "inbound"}>
          {t("blocked.tabInbound", { n: inboundRes.count ?? 0 })}
        </TabLink>
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          message={tab === "blocked" ? t("blocked.empty") : t("blocked.emptyInbound")}
          action={
            <Button asChild variant="outline" className="h-11">
              <Link href={link("/bikes/new")}>{t("bikes.new")}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="board">
          {rows.map((row) => (
            <li key={row.job_card_id}>
              <BoardCard
                row={row}
                t={t}
                now={now}
                inbound={tab === "inbound"}
                href={link(`/job-cards/${row.job_card_id}`)}
                userId={user.id}
                workshopId={workshop.id}
              />
            </li>
          ))}
        </ul>
      )}
      {rows.length === BOARD_LIMIT && <p className="mt-3 text-sm text-muted-foreground">{t("blocked.limited", { n: BOARD_LIMIT })}</p>}
    </>
  );
}

function Kpi({ label, value, sub, danger, testId }: { label: string; value: string; sub?: string; danger?: boolean; testId?: string }) {
  return (
    <div className="min-w-0 rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p data-testid={testId} className={cn("text-2xl font-semibold tabular-nums", danger && "text-destructive")}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center rounded-lg px-3 text-sm font-medium",
        active ? "bg-primary text-primary-foreground" : "border hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

function BoardCard({
  row,
  t,
  now,
  inbound,
  href,
  userId,
  workshopId,
}: {
  row: BoardRow;
  t: TFunction;
  now: number;
  inbound: boolean;
  href: string;
  userId: string;
  workshopId: string;
}) {
  const notOrdered = row.missing_parts.some((p) => p.eta_status === "not_ordered");
  return (
    <article className="flex flex-col gap-3 rounded-xl border p-3" data-testid={`board-row-${row.card_code}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={href} className="font-mono text-lg font-semibold underline-offset-4 hover:underline">
            {row.reg_no}
          </Link>
          <p className="text-sm break-words">
            {row.make} {row.model}
            {" · "}
            {row.variant_name ?? t("bikes.unknownVariant")}
            {" · "}
            {row.mfg_year}
          </p>
          <p className="text-sm text-muted-foreground">
            {inbound ? t("blocked.purchased") : t("blocked.waitingSince")} {formatIST(row.since)} ·{" "}
            <span className="font-medium text-foreground">{formatDuration(row.since, now, t)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{row.card_code}</span>
          <StatusBadge enum="bike_status" value={row.bike_status} />
        </div>
      </div>

      {row.needs_review_reason && (
        <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          <span className="font-medium">{t("blocked.chooseCorrectPart")}</span> · {row.needs_review_reason}
        </p>
      )}

      {row.missing_parts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {row.missing_parts.map((p) => (
            <li key={p.line_id} className="flex flex-col gap-1 border-t pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  <span className="font-mono text-sm">{p.sku}</span> {p.name}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">
                    {p.uncovered} {t(`enums.uom.${p.uom}`)}
                  </span>
                  <EtaBadge part={p} t={t} />
                </span>
              </div>
              {p.reallocation_candidates.length > 0 && (
                <p className="text-xs text-sky-800 dark:text-sky-200" data-testid="reallocation-marker">
                  {t("blocked.reallocationCandidate", {
                    list: p.reallocation_candidates.map((c) => `${c.reg_no} (${c.card_code}, ${c.qty_reserved})`).join(", "),
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild className="h-11">
          <Link href={href}>{t("blocked.openJobCard")}</Link>
        </Button>
        {notOrdered && <GeneratePosButton userId={userId} workshopId={workshopId} compact />}
      </div>
    </article>
  );
}
