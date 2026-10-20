import type { Metadata } from "next";
import Link from "next/link";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { EtaBadge } from "@/components/eta-badge";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { bikeLabel } from "../card-finder";

export const metadata: Metadata = { title: "Emergency buy · Vutto Parts" };

type Enums = Database["public"]["Enums"];

/**
 * Lines a store keeper may cover with an emergency buy: uncovered lines on bikes at the workshop
 * or in a bay, in_repair first, each with its ETA (PO code and due date, or "Not ordered"), so a PO
 * due soon can be waited for instead (SPEC §7.6, §8.3).
 */
export default async function EmergencyListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { profile, workshop } = await requireRole("/store/emergency", sp);
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const res = await supabase
    .from("v_store_waiting_lines")
    .select("line_id, card_code, reg_no, bike_status, make, model, variant_name, mfg_year, sku, name, name_hi, uom, uncovered, eta_status, po_code, expected_on, is_overdue")
    .eq("workshop_id", workshop.id)
    .order("bike_status", { ascending: false })
    .order("needed_by", { ascending: true, nullsFirst: false })
    .order("card_code")
    .order("sku")
    .limit(200);
  if (res.error) throw res.error;
  const rows = res.data ?? [];

  return (
    <>
      <PageHeader
        title={t("emergency.listTitle")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          message={t("emergency.listEmpty")}
          action={
            <Button asChild variant="outline" className="h-12">
              <Link href={link("/store")}>{t("store.backToStore")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">{t("emergency.listHint")}</p>
          <ul className="flex flex-col gap-2" data-testid="waiting-list">
            {rows.map((r) => (
              <li key={r.line_id}>
                <Link
                  href={link(`/store/emergency/${r.line_id}`)}
                  className="flex flex-col gap-1 rounded-xl border p-3 hover:bg-muted"
                  data-testid={`waiting-${r.card_code}-${r.sku}`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-lg font-semibold">{r.reg_no}</span>
                    <StatusBadge enum="bike_status" value={r.bike_status as Enums["bike_status"]} />
                  </span>
                  <span className="text-sm">{bikeLabel(r, t)}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono">{r.sku}</span>
                    <span className="font-semibold tabular-nums">
                      {t("emergency.needs", { qty: r.uncovered ?? 0, uom: t(`enums.uom.${r.uom as Enums["uom"]}`) })}
                    </span>
                  </span>
                  <span className="break-words">{r.name}</span>
                  {r.name_hi && <span className="text-sm text-muted-foreground">{r.name_hi}</span>}
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-muted-foreground">{r.card_code}</span>
                    <EtaBadge part={r} t={t} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
