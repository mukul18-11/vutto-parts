import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { canAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatIST } from "@/lib/time";
import { BinCountWrong, StockSearch } from "./stock-client";

export const metadata: Metadata = { title: "Stock · Vutto Parts" };

type Uom = Database["public"]["Enums"]["uom"];
type BinKind = Database["public"]["Enums"]["bin_kind"];
const LEDGER_ROWS = 20;

/** Stock lookup (SPEC §4): every number comes from v_stock_position and the ledger, none from TS. */
export default async function StockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { user, profile, workshop } = await requireRole("/stock", sp);
  const t = await getT();
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  const partId = typeof sp.part === "string" && z.guid().safeParse(sp.part).success ? sp.part : null;
  const manager = canAccess(profile.role, "/stock/count");

  const header = (
    <PageHeader
      title={t("pages.stock")}
      subtitle={
        <span className="flex flex-wrap gap-x-2">
          <span>{`${workshop.name} (${workshop.code})`}</span>
          <AsOf />
        </span>
      }
      actions={
        manager && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="h-11">
              <Link href={link("/stock/count")}>{t("count.title")}</Link>
            </Button>
            <Button asChild variant="outline" className="h-11">
              <Link href={link("/stock/quarantine")}>{t("quarantine.title")}</Link>
            </Button>
          </div>
        )
      }
    />
  );
  const search = <StockSearch workshopId={workshop.id} selectedId={partId} baseHref={link("/stock")} />;
  if (!partId) {
    return (
      <>
        {header}
        {search}
        <EmptyState message={t("stock.pickPart")} className="mt-4" />
      </>
    );
  }

  const supabase = await createClient();
  const [partRes, posRes, binsRes, ledgerRes] = await Promise.all([
    supabase.from("parts").select("id, sku, name, name_hi, uom, oem_part_no").eq("id", partId).maybeSingle(),
    supabase
      .from("v_stock_position")
      .select("usable_on_hand, quarantine_on_hand, reserved, available, on_order, outstanding_demand, shortfall")
      .eq("workshop_id", workshop.id)
      .eq("part_id", partId)
      .maybeSingle(),
    supabase
      .from("stock_balances")
      .select("on_hand, bins(id, code, kind, count_requested_at)")
      .eq("workshop_id", workshop.id)
      .eq("part_id", partId)
      .gt("on_hand", 0),
    supabase.rpc("stock_ledger", { p_workshop_id: workshop.id, p_part_id: partId, p_limit: LEDGER_ROWS }),
  ]);
  for (const res of [partRes, posRes, binsRes, ledgerRes]) if (res.error) throw res.error;
  const part = partRes.data;
  if (!part) {
    return (
      <>
        {header}
        {search}
        <EmptyState message={t("common.notFound")} className="mt-4" />
      </>
    );
  }
  const pos = posRes.data;
  const uom = t(`enums.uom.${part.uom as Uom}`);
  const bins = (binsRes.data ?? [])
    .map((b) => ({ on_hand: b.on_hand, bin: b.bins as { id: string; code: string; kind: BinKind; count_requested_at: string | null } }))
    .sort((a, b) => a.bin.code.localeCompare(b.bin.code));
  const figures: [string, number | null | undefined, string?][] = [
    [t("stock.available"), pos?.available, "stock-available"],
    [t("stock.onHand"), pos?.usable_on_hand, "stock-on-hand"],
    [t("stock.reserved"), pos?.reserved],
    [t("stock.quarantine"), pos?.quarantine_on_hand],
    [t("stock.onOrder"), pos?.on_order],
    [t("stock.shortfall"), pos?.shortfall],
  ];

  return (
    <>
      {header}
      {search}
      <section className="mt-4 rounded-xl border p-3" data-testid="stock-part">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{part.sku}</span>
          {part.oem_part_no && <span className="font-mono text-sm text-muted-foreground">{part.oem_part_no}</span>}
        </p>
        <p className="break-words text-lg font-medium">{part.name}</p>
        {part.name_hi && <p className="text-muted-foreground">{part.name_hi}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {figures.map(([label, value, testId]) => (
            <div key={label} className="rounded-lg bg-muted/50 p-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums" data-testid={testId}>
                {`${value ?? 0} ${uom}`}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4">
        <h2 className="mb-2 text-lg font-semibold">{t("stock.bins")}</h2>
        {bins.length === 0 ? (
          <EmptyState message={t("stock.noBins")} />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="stock-bins">
            {bins.map((b) => (
              <li key={b.bin.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3" data-testid={`stock-bin-${b.bin.code}`}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{b.bin.code}</span>
                  {b.bin.kind !== "normal" && <StatusBadge enum="bin_kind" value={b.bin.kind} />}
                  <span className="tabular-nums" data-testid="bin-qty">{`${b.on_hand} ${uom}`}</span>
                </span>
                {b.bin.count_requested_at ? (
                  <Badge variant="outline">{t("stock.countRequested", { at: formatIST(b.bin.count_requested_at) })}</Badge>
                ) : (
                  <BinCountWrong userId={user.id} binId={b.bin.id} code={b.bin.code} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4">
        <h2 className="mb-2 text-lg font-semibold">{t("stock.lastMoves", { n: LEDGER_ROWS })}</h2>
        {(ledgerRes.data ?? []).length === 0 ? (
          <EmptyState message={t("stock.noMoves")} />
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border" data-testid="stock-ledger">
            {(ledgerRes.data ?? []).map((m) => (
              <li
                key={m.id}
                className="flex flex-col gap-0.5 p-2 text-sm"
                data-testid="ledger-move"
                data-move-type={m.move_type}
                data-card={m.job_card_code ?? undefined}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`enums.move_type.${m.move_type}`)}</span>
                  <span className="tabular-nums">{`${m.qty} ${uom}`}</span>
                  <span className="font-mono text-xs">
                    {`${m.from_bin_code ?? "–"} → ${m.to_bin_code ?? "–"}`}
                  </span>
                  {m.is_simulated && <Badge variant="outline">{t("common.simulated")}</Badge>}
                </span>
                <span className="text-muted-foreground">
                  {[
                    formatIST(m.created_at),
                    m.user_full_name,
                    m.job_card_code && `${m.job_card_code} ${m.reg_no ?? ""}`.trim(),
                    m.grn_code && `${m.grn_code}${m.po_code ? ` (${m.po_code})` : ""}`,
                    m.emergency_vendor,
                    m.reason,
                    m.note,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
