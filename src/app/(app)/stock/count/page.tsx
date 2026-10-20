import type { Metadata } from "next";
import Link from "next/link";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Cycle count · Vutto Parts" };

/** The manager's count list: bins with a count request first (oldest request first), then by code. */
export default async function CountListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { profile, workshop } = await requireRole("/stock/count", sp);
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const res = await supabase
    .from("v_count_bins")
    .select("id, code, kind, count_requested_at, part_count, total_on_hand")
    .eq("workshop_id", workshop.id)
    .order("count_requested_at", { ascending: true, nullsFirst: false })
    .order("code");
  if (res.error) throw res.error;
  const bins = res.data ?? [];
  const requested = bins.filter((b) => b.count_requested_at).length;

  return (
    <>
      <PageHeader
        title={t("count.title")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <span>{t("count.requestedN", { n: requested })}</span>
            <AsOf />
          </span>
        }
      />
      {bins.length === 0 ? (
        <EmptyState message={t("count.empty")} />
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="count-list">
          {bins.map((b) => (
            <li key={b.id}>
              <Link
                href={link(`/stock/count/${b.id}`)}
                className="flex min-h-16 flex-col gap-1 rounded-xl border p-3 hover:bg-muted"
                data-testid={`count-bin-${b.code}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{b.code}</span>
                  {b.kind !== "normal" && <StatusBadge enum="bin_kind" value={b.kind as Database["public"]["Enums"]["bin_kind"]} />}
                  {b.count_requested_at && (
                    <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                      {t("count.requestedAt", { at: formatIST(b.count_requested_at) })}
                    </Badge>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("count.binSummary", { parts: b.part_count ?? 0, qty: b.total_on_hand ?? 0 })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
