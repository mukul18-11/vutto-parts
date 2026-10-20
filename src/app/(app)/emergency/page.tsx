import type { Metadata } from "next";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { isHighPremium, premiumPercent } from "@/lib/store";
import { createClient } from "@/lib/supabase/server";
import { formatIST } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Emergency buys · Vutto Parts" };

type Enums = Database["public"]["Enums"];
const LIMIT = 100;

/**
 * Emergency buys for the manager (SPEC §8.3, §10): price, reference, premium (red above 25%).
 * Bill photos are out of scope, so there is no bill column or "Bill missing" filter.
 */
export default async function EmergencyBuysPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workshop } = await requireRole("/emergency", await searchParams);
  const t = await getT();
  const supabase = await createClient();

  const res = await supabase
    .from("v_emergency_buys_list")
    .select("id, created_at, card_code, reg_no, sku, part_name, uom, vendor_name, qty, unit_price_paise, reference_price_paise, reason, bought_by_name, is_simulated")
    .eq("workshop_id", workshop.id)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(LIMIT);
  if (res.error) throw res.error;
  const rows = res.data ?? [];

  return (
    <>
      <PageHeader
        title={t("pages.emergency")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
      />
      {rows.length === 0 ? (
        <EmptyState message={t("emergencyList.empty")} />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">{t("emergencyList.intro", { n: LIMIT })}</p>
          <div className="overflow-x-auto rounded-xl border">
            <Table data-testid="emergency-buys">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("emergencyList.date")}</TableHead>
                  <TableHead>{t("emergencyList.bike")}</TableHead>
                  <TableHead>{t("emergencyList.part")}</TableHead>
                  <TableHead>{t("emergencyList.vendor")}</TableHead>
                  <TableHead className="text-right">{t("emergencyList.qty")}</TableHead>
                  <TableHead className="text-right">{t("emergencyList.price")}</TableHead>
                  <TableHead className="text-right">{t("emergencyList.reference")}</TableHead>
                  <TableHead className="text-right">{t("emergencyList.premium")}</TableHead>
                  <TableHead>{t("emergencyList.reason")}</TableHead>
                  <TableHead>{t("emergencyList.by")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const price = Number(r.unit_price_paise);
                  const ref = r.reference_price_paise === null ? null : Number(r.reference_price_paise);
                  const pct = premiumPercent(price, ref);
                  return (
                    <TableRow key={r.id} data-testid={`buy-${r.id}`}>
                      <TableCell className="whitespace-nowrap">
                        {r.created_at ? formatIST(r.created_at) : ""}
                        {r.is_simulated && (
                          <Badge variant="outline" className="ml-1">
                            {t("common.simulated")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono">{r.reg_no}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{r.card_code}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{r.sku}</span>
                        <span className="block">{r.part_name}</span>
                      </TableCell>
                      <TableCell>{r.vendor_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{`${r.qty} ${t(`enums.uom.${r.uom as Enums["uom"]}`)}`}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(price)}</TableCell>
                      <TableCell className="text-right tabular-nums">{ref === null ? t("emergencyList.noReference") : formatINR(ref)}</TableCell>
                      <TableCell
                        className={cn("text-right tabular-nums", isHighPremium(price, ref) && "font-semibold text-red-700 dark:text-red-400")}
                        data-testid="buy-premium"
                      >
                        {pct === null ? t("emergencyList.noReference") : `${pct > 0 ? "+" : ""}${pct}%`}
                      </TableCell>
                      <TableCell>
                        {r.reason && <StatusBadge enum="emergency_reason" value={r.reason as Enums["emergency_reason"]} />}
                      </TableCell>
                      <TableCell>{r.bought_by_name}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
