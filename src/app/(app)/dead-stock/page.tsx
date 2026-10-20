import type { Metadata } from "next";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatIST, istToday } from "@/lib/time";
import { ReturnToSupplier } from "../stock/quarantine/quarantine-actions";

export const metadata: Metadata = { title: "Dead stock · Vutto Parts" };

type Enums = Database["public"]["Enums"];
type PriceSource = "last_grn" | "supplier" | "standard";

/**
 * Dead stock (SPEC §10): available stock with no issue, grn or emergency_in move in 90 IST days,
 * valued at the last price; the footer total is the same SQL as the metrics tile. Quarantine stock
 * is listed separately as "Pending return to supplier", with the return action (manager).
 */
export default async function DeadStockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { user, workshop } = await requireRole("/dead-stock", sp);
  const t = await getT();
  const supabase = await createClient();
  const today = istToday();

  const [deadRes, kpiRes, quarantineRes] = await Promise.all([
    supabase.rpc("dead_stock_list", { p_workshop_id: workshop.id }),
    supabase.rpc("kpis", { p_workshop_id: workshop.id, p_from: today, p_to: today }),
    supabase
      .from("v_quarantine_stock")
      .select("bin_id, bin_code, part_id, sku, name, name_hi, uom, on_hand, last_in_at")
      .eq("workshop_id", workshop.id)
      .order("last_in_at", { ascending: true }),
  ]);
  if (deadRes.error) throw deadRes.error;
  if (kpiRes.error) throw kpiRes.error;
  if (quarantineRes.error) throw quarantineRes.error;
  const dead = deadRes.data ?? [];
  const k = kpiRes.data[0];
  const quarantine = quarantineRes.data ?? [];

  return (
    <>
      <PageHeader
        title={t("pages.deadStock")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
      />
      <p className="mb-3 text-sm text-muted-foreground">{t("deadStock.intro")}</p>

      {dead.length === 0 ? (
        <EmptyState message={t("deadStock.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table data-testid="dead-stock-list">
            <TableHeader>
              <TableRow>
                <TableHead>{t("deadStock.part")}</TableHead>
                <TableHead className="text-right">{t("deadStock.deadQty")}</TableHead>
                <TableHead className="text-right">{t("deadStock.unitPrice")}</TableHead>
                <TableHead className="text-right">{t("deadStock.value")}</TableHead>
                <TableHead>{t("deadStock.age")}</TableHead>
                <TableHead>{t("deadStock.lastMove")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dead.map((d) => (
                <TableRow key={d.part_id} data-testid={`dead-${d.sku}`}>
                  <TableCell>
                    <span className="font-mono text-xs">{d.sku}</span>
                    <span className="block">{d.name}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{`${d.dead_qty} ${t(`enums.uom.${d.uom}`)}`}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(Number(d.unit_price_paise))}
                    <span className="block text-xs text-muted-foreground">{t(`deadStock.priceSource.${d.price_source as PriceSource}`)}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatINR(Number(d.value_paise))}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {d.age_days === null ? t("deadStock.neverMoved") : t("deadStock.ageDays", { n: d.age_days })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {d.last_move_at && (
                      <>
                        {formatIST(d.last_move_at)}
                        <span className="block text-xs text-muted-foreground">{t(`enums.move_type.${d.last_move_type as Enums["move_type"]}`)}</span>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="mt-3 text-sm font-medium" data-testid="dead-stock-footer">
        {t("deadStock.footer", { n: k.dead_stock_sku_n, value: formatINR(Number(k.dead_stock_value_paise)) })}
      </p>

      <section className="mt-8" aria-labelledby="pending-return">
        <h2 id="pending-return" className="text-lg font-semibold">
          {t("deadStock.quarantineTitle")}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">{t("deadStock.quarantineIntro")}</p>
        {quarantine.length === 0 ? (
          <EmptyState message={t("deadStock.quarantineEmpty")} />
        ) : (
          <ul className="flex flex-col gap-3" data-testid="pending-return-list">
            {quarantine.map((q) => {
              const item = {
                bin_id: q.bin_id as string,
                bin_code: q.bin_code as string,
                part_id: q.part_id as string,
                sku: q.sku as string,
                uom: q.uom as Enums["uom"],
                on_hand: q.on_hand as number,
              };
              return (
                <li key={`${q.bin_id}:${q.part_id}`} className="flex flex-col gap-2 rounded-xl border p-3" data-testid={`pending-${q.sku}`}>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{q.sku}</span>
                    <span className="font-semibold tabular-nums">{`${q.on_hand} ${t(`enums.uom.${item.uom}`)}`}</span>
                    <span className="font-mono text-xs text-muted-foreground">{q.bin_code}</span>
                  </p>
                  <p className="break-words">{q.name}</p>
                  {q.name_hi && <p className="text-sm text-muted-foreground">{q.name_hi}</p>}
                  {q.last_in_at && <p className="text-sm text-muted-foreground">{`${t("deadStock.since")}: ${formatIST(q.last_in_at)}`}</p>}
                  <div>
                    <ReturnToSupplier userId={user.id} item={item} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
