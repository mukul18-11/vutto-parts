import type { Metadata } from "next";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TabLink } from "@/components/tab-link";
import { Badge } from "@/components/ui/badge";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { addDaysIST, formatDateOnly, istToday } from "@/lib/time";
import { AddSetting, SettingsDialog, type Setting, type SupplierOption } from "./settings";

export const metadata: Metadata = { title: "Reorder · Vutto Parts" };

type Mode = "all" | "auto" | "on_demand";

export default async function ReorderPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { user, profile, workshop } = await requireRole("/reorder", sp);
  const t = await getT();
  const supabase = await createClient();
  const below = sp.below === "1";
  const mode: Mode = sp.mode === "auto" || sp.mode === "on_demand" ? sp.mode : "all";
  const href = (next: { below?: boolean; mode?: Mode }) => {
    const b = next.below ?? below;
    const m = next.mode ?? mode;
    const qs = new URLSearchParams();
    if (b) qs.set("below", "1");
    if (m !== "all") qs.set("mode", m);
    const s = qs.toString();
    return withWs(`/reorder${s ? `?${s}` : ""}`, profile.role, workshop.code);
  };

  // Same SQL function as draft generation (SPEC §10); filters run in PostgREST.
  let query = supabase.rpc("reorder_suggestions", { p_workshop_id: workshop.id });
  if (below) query = query.gt("order_qty", 0);
  if (mode !== "all") query = query.eq("is_auto", mode === "auto");
  const [rowsRes, settingsRes, suppliersRes, uomRes] = await Promise.all([
    query.order("sku"),
    supabase
      .from("reorder_settings")
      .select("part_id, auto, safety_stock, max_qty, preferred_supplier_id")
      .eq("workshop_id", workshop.id),
    supabase.from("suppliers").select("id, name, lead_time_days").eq("is_active", true).order("name"),
    // The catalogue is a few hundred parts (well under the 1,000-row cap).
    supabase.from("parts").select("id, uom"),
  ]);
  for (const res of [rowsRes, settingsRes, suppliersRes, uomRes]) if (res.error) throw res.error;
  const uomOf = new Map((uomRes.data ?? []).map((p) => [p.id, p.uom]));

  const rows = rowsRes.data ?? [];
  const settings = new Map<string, Setting>((settingsRes.data ?? []).map((s) => [s.part_id, s]));
  const suppliers: SupplierOption[] = suppliersRes.data ?? [];
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const yesterday = formatDateOnly(addDaysIST(istToday(), -1));
  const enoughHistory = rows.length === 0 || rows[0].enough_history;

  return (
    <>
      <PageHeader
        title={t("pages.reorder")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
        actions={<AddSetting userId={user.id} workshopId={workshop.id} suppliers={suppliers} />}
      />
      <p className="mb-3 text-sm text-muted-foreground">
        {enoughHistory ? t("reorder.basedOn", { date: yesterday }) : t("reorder.notEnoughHistory")}
      </p>

      <nav aria-label={t("reorder.filters")} className="mb-3 flex flex-wrap gap-2">
        <TabLink href={href({ below: !below })} active={below}>
          {t("reorder.belowRop")}
        </TabLink>
        <TabLink href={href({ mode: "all" })} active={mode === "all"}>
          {t("reorder.modeAll")}
        </TabLink>
        <TabLink href={href({ mode: "auto" })} active={mode === "auto"}>
          {t("reorder.modeAuto")}
        </TabLink>
        <TabLink href={href({ mode: "on_demand" })} active={mode === "on_demand"}>
          {t("reorder.modeOnDemand")}
        </TabLink>
      </nav>

      {rows.length === 0 ? (
        <EmptyState message={t("reorder.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[56rem] text-sm" data-testid="reorder-table">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">{t("reorder.part")}</th>
                <th className="p-2 text-right">{t("reorder.usable")}</th>
                <th className="p-2 text-right">{t("reorder.onOrder")}</th>
                <th className="p-2 text-right">{t("reorder.demand")}</th>
                <th className="p-2 text-right">{t("reorder.projected")}</th>
                <th className="p-2 text-right">{t("reorder.avgDaily")}</th>
                <th className="p-2 text-right">{t("reorder.lead")}</th>
                <th className="p-2 text-right">{t("reorder.rop")}</th>
                <th className="p-2 text-right">{t("reorder.orderQty")}</th>
                <th className="p-2">{t("reorder.supplier")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.part_id} className="border-t" data-testid={`reorder-${r.sku}`}>
                  <td className="p-2">
                    <span className="font-mono">{r.sku}</span>{" "}
                    <Badge variant={r.is_auto ? "secondary" : "outline"}>
                      {r.is_auto ? t("reorder.auto") : t("reorder.onDemand")}
                    </Badge>
                    <div className="break-words">{r.name}</div>
                  </td>
                  <td className="p-2 text-right tabular-nums">{r.usable_on_hand}</td>
                  <td className="p-2 text-right tabular-nums">{r.on_order}</td>
                  <td className="p-2 text-right tabular-nums">{r.outstanding_demand}</td>
                  <td className="p-2 text-right tabular-nums">{r.projected}</td>
                  <td className="p-2 text-right tabular-nums">{Number(r.avg_daily_issue_28d).toFixed(2)}</td>
                  <td className="p-2 text-right tabular-nums">{t("reorder.days", { n: r.lead_time_days ?? 0 })}</td>
                  <td className="p-2 text-right tabular-nums">{r.rop ?? "–"}</td>
                  <td className="p-2 text-right font-medium tabular-nums">{r.order_qty > 0 ? r.order_qty : "–"}</td>
                  <td className="p-2">
                    {r.effective_supplier_id ? (
                      supplierName.get(r.effective_supplier_id) ?? "–"
                    ) : (
                      <Badge variant="destructive">{t("reorder.needsSupplier")}</Badge>
                    )}
                  </td>
                  <td className="p-2">
                    <SettingsDialog
                      userId={user.id}
                      workshopId={workshop.id}
                      part={{ part_id: r.part_id, sku: r.sku, uom: uomOf.get(r.part_id) ?? "pcs" }}
                      current={settings.get(r.part_id) ?? null}
                      suppliers={suppliers}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
