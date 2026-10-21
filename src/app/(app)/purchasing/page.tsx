import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TabLink } from "@/components/tab-link";
import { Badge } from "@/components/ui/badge";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { formatINR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatDateOnly } from "@/lib/time";
import { GeneratePosButton } from "../blocked/generate-pos-button";
import { NeedsSupplier } from "./needs-supplier";

export const metadata: Metadata = { title: "Purchasing · Vutto Parts" };

type PoStatus = Database["public"]["Enums"]["po_status"];
type Tab = "draft" | "sent" | "closed" | "all";

const TAB_STATUSES: Record<Tab, PoStatus[]> = {
  draft: ["draft"],
  sent: ["sent", "partially_received"],
  closed: ["received", "closed", "cancelled"],
  all: ["draft", "sent", "partially_received", "received", "closed", "cancelled"],
};
const LIST_LIMIT = 200;

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { user, profile, workshop } = await requireRole("/purchasing", sp);
  const t = await getT();
  const supabase = await createClient();
  const tab: Tab = sp.tab === "sent" || sp.tab === "closed" || sp.tab === "all" ? sp.tab : "draft";
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const count = (statuses: PoStatus[]) =>
    supabase
      .from("v_po_list")
      .select("id", { count: "exact", head: true })
      .eq("workshop_id", workshop.id)
      .in("status", statuses);

  let list = supabase
    .from("v_po_list")
    .select(
      "id, code, status, supplier_name, sent_at, expected_on, is_overdue, line_count, open_qty, total_paise, missing_price_count, created_at",
    )
    .eq("workshop_id", workshop.id)
    .in("status", TAB_STATUSES[tab]);
  list =
    tab === "sent"
      ? list.order("is_overdue", { ascending: false }).order("expected_on", { ascending: true }).order("code")
      : list.order("created_at", { ascending: false }).order("code", { ascending: false });

  // One batch after the route guard. The open sent lines and the uom of unsourced parts are read
  // up front (both small: open lines on sent POs, and parts with no preferred supplier, a superset
  // of the unsourced ones) and matched below, so the page needs no third round trip.
  const [draftN, sentN, closedN, allN, listRes, needsRes, suppliersRes, excessRes, openRes, uomRes] = await Promise.all([
    count(TAB_STATUSES.draft),
    count(TAB_STATUSES.sent),
    count(TAB_STATUSES.closed),
    count(TAB_STATUSES.all),
    list.limit(LIST_LIMIT),
    supabase
      .rpc("reorder_suggestions", { p_workshop_id: workshop.id })
      .gt("order_qty", 0)
      .is("effective_supplier_id", null)
      .order("sku"),
    supabase.from("suppliers").select("id, name, city, lead_time_days").eq("is_active", true).order("name"),
    supabase
      .from("v_excess_on_order")
      .select("part_id, sku, name, on_order, projected, target, excess")
      .eq("workshop_id", workshop.id)
      .order("sku"),
    supabase
      .from("po_lines")
      .select("part_id, open_qty, po_id, purchase_orders!inner(code, status)")
      .eq("workshop_id", workshop.id)
      .gt("open_qty", 0)
      .in("purchase_orders.status", ["sent", "partially_received"]),
    supabase.from("parts").select("id, uom").is("preferred_supplier_id", null),
  ]);
  for (const res of [draftN, sentN, closedN, allN, listRes, needsRes, suppliersRes, excessRes, openRes, uomRes]) {
    if (res.error) throw res.error;
  }

  const excess = excessRes.data ?? [];
  const needs = needsRes.data ?? [];
  const uomOf = new Map((uomRes.data ?? []).map((p) => [p.id, p.uom]));
  const openByPart = new Map<string, { po_id: string; code: string; open_qty: number }[]>();
  const excessParts = new Set(excess.map((e) => e.part_id as string));
  for (const l of (openRes.data ?? []).filter((x) => excessParts.has(x.part_id))) {
    const entry = { po_id: l.po_id, code: l.purchase_orders.code, open_qty: l.open_qty as number };
    openByPart.set(l.part_id, [...(openByPart.get(l.part_id) ?? []), entry]);
  }

  const rows = listRes.data ?? [];
  const tabs: { key: Tab; label: string; n: number | null }[] = [
    { key: "draft", label: t("purchasing.tabDraft"), n: draftN.count },
    { key: "sent", label: t("purchasing.tabSent"), n: sentN.count },
    { key: "closed", label: t("purchasing.tabClosed"), n: closedN.count },
    { key: "all", label: t("purchasing.tabAll"), n: allN.count },
  ];

  return (
    <>
      <PageHeader
        title={t("pages.purchasing")}
        subtitle={`${workshop.name} (${workshop.code})`}
        actions={<GeneratePosButton userId={user.id} workshopId={workshop.id} />}
      />

      {needs.length > 0 && (
        <NeedsSupplier
          userId={user.id}
          workshopId={workshop.id}
          parts={needs.map((p) => ({
            part_id: p.part_id,
            sku: p.sku,
            name: p.name,
            qty: p.order_qty,
            uom: uomOf.get(p.part_id) ?? "pcs",
          }))}
          suppliers={suppliersRes.data ?? []}
        />
      )}

      <nav aria-label={t("purchasing.tabs")} className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {tabs.map((tb) => (
          <TabLink key={tb.key} href={link(`/purchasing?tab=${tb.key}`)} active={tab === tb.key}>
            {`${tb.label} (${tb.n ?? 0})`}
          </TabLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState message={tab === "draft" ? t("purchasing.emptyDraft") : t("purchasing.empty")} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="po-list">
          {rows.map((po) => (
            <li key={po.id}>
              <Link
                href={link(`/purchasing/${po.id}`)}
                className="flex flex-col gap-1 rounded-xl border p-3 hover:bg-muted"
                data-testid={`po-${po.code}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{po.code}</span>
                  <StatusBadge enum="po_status" value={po.status as PoStatus} />
                  {po.is_overdue && <Badge variant="destructive">{t("purchasing.overdue")}</Badge>}
                  {(po.missing_price_count ?? 0) > 0 && <Badge variant="outline">{t("purchasing.missingPrices")}</Badge>}
                </span>
                <span className="break-words">{po.supplier_name}</span>
                <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                  <span>{t("purchasing.lineCount", { n: po.line_count ?? 0 })}</span>
                  <span>{t("purchasing.totalInclGst", { total: formatINR(Number(po.total_paise ?? 0)) })}</span>
                  {po.expected_on && <span>{t("purchasing.expectedOn", { date: formatDateOnly(po.expected_on) })}</span>}
                  {po.status !== "draft" && (po.open_qty ?? 0) > 0 && (
                    <span>{t("purchasing.openQty", { n: po.open_qty ?? 0 })}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length === LIST_LIMIT && <p className="mt-2 text-sm text-muted-foreground">{t("purchasing.limited", { n: LIST_LIMIT })}</p>}

      <section aria-labelledby="excess-title" className="mt-8">
        <h2 id="excess-title" className="mb-1 text-lg font-semibold">
          {t("purchasing.excessTitle")}
        </h2>
        <p className="mb-2 text-sm text-muted-foreground">{t("purchasing.excessHint")}</p>
        {excess.length === 0 ? (
          <EmptyState message={t("purchasing.excessEmpty")} />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="excess-list">
            {excess.map((e) => (
              <li key={e.part_id} className="rounded-xl border p-3">
                <p className="flex flex-wrap gap-2">
                  <span className="font-mono text-sm">{e.sku}</span>
                  <span className="break-words">{e.name}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("purchasing.excessLine", {
                    excess: e.excess ?? 0,
                    onOrder: e.on_order ?? 0,
                    projected: e.projected ?? 0,
                    target: e.target ?? 0,
                  })}
                </p>
                <p className="mt-1 flex flex-wrap gap-2 text-sm">
                  {(openByPart.get(e.part_id as string) ?? []).map((o) => (
                    <Link key={o.po_id} href={link(`/purchasing/${o.po_id}`)} className="underline underline-offset-2">
                      {t("purchasing.excessOpenOn", { code: o.code, qty: o.open_qty })}
                    </Link>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
