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
import { formatDateOnly } from "@/lib/time";

export const metadata: Metadata = { title: "Receive · Vutto Parts" };

/** Sent and partially received POs of the workshop, overdue first (SPEC §7.4). */
export default async function ReceiveListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { profile, workshop } = await requireRole("/store/receive", sp);
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const res = await supabase
    .from("v_po_list")
    .select("id, code, status, supplier_name, expected_on, is_overdue, line_count")
    .eq("workshop_id", workshop.id)
    .in("status", ["sent", "partially_received"])
    .order("is_overdue", { ascending: false })
    .order("expected_on", { ascending: true })
    .order("code");
  if (res.error) throw res.error;
  const rows = res.data ?? [];

  return (
    <>
      <PageHeader
        title={t("receive.title")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
      />
      {rows.length === 0 ? (
        <EmptyState message={t("receive.empty")} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="receive-list">
          {rows.map((po) => (
            <li key={po.id}>
              <Link
                href={link(`/store/receive/${po.id}`)}
                className="flex min-h-16 flex-col gap-1 rounded-xl border p-3 hover:bg-muted"
                data-testid={`receive-${po.code}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{po.code}</span>
                  <StatusBadge enum="po_status" value={po.status as Database["public"]["Enums"]["po_status"]} />
                  {po.is_overdue && <Badge variant="destructive">{t("purchasing.overdue")}</Badge>}
                </span>
                <span className="break-words">{po.supplier_name}</span>
                <span className="text-sm text-muted-foreground">
                  {po.expected_on ? t("purchasing.expectedOn", { date: formatDateOnly(po.expected_on) }) : ""}
                  {" · "}
                  {t("purchasing.lineCount", { n: po.line_count ?? 0 })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
