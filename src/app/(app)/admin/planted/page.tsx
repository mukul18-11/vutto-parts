import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { hrefWith } from "@/lib/metrics";
import { planted, type PlantedWorkshop } from "@/lib/planted";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Planted demo scenarios · Vutto Parts" };

const WORKSHOPS = ["NCR", "JPR"] as const;
type Code = (typeof WORKSHOPS)[number];

/** A code shown as a link when it resolves to a row, else as plain text. */
type Item = { label: string; href: string | null };
type Row = { scenario: string; items: Item[]; list?: { href: string; label: string } };

/**
 * Planted scenarios (SPEC §15) from scripts/seed/planted.json, never hard-coded. Codes are resolved
 * to ids with the admin's client (RLS: admin reads every workshop); links carry ?ws= of that workshop.
 */
export default async function PlantedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireRole("/admin/planted", await searchParams);
  const t = await getT();
  const supabase = await createClient();

  const cardCodes = new Set<string>();
  const poCodes = new Set<string>();
  const skus = new Set<string>();
  for (const code of WORKSHOPS) {
    const w = planted[code];
    for (const c of w.chains) {
      cardCodes.add(c.card_code);
      poCodes.add(c.po_code);
      skus.add(c.sku);
    }
    [w.po_due_tomorrow, w.po_overdue, w.po_partially_received].forEach((c) => poCodes.add(c));
    [
      ...w.receiving.reserved_for,
      ...w.ready_to_issue,
      ...w.blocked.in_transit,
      ...w.blocked.overdue_po,
      ...w.blocked.not_ordered,
      ...w.blocked.flagged_fitment,
      ...w.inbound_shortfall,
      ...w.emergency_buy_cards,
      w.unsourced.card_code,
      w.unknown_variant.card_code,
      ...(w.flagged_fitment ? [w.flagged_fitment.card_code] : []),
    ].forEach((c) => cardCodes.add(c));
    [w.receiving.sku, w.unsourced.sku, ...(w.flagged_fitment ? [w.flagged_fitment.sku] : [])].forEach((s) => skus.add(s));
  }

  const [cardsRes, posRes, partsRes] = await Promise.all([
    supabase.from("job_cards").select("id, code").in("code", [...cardCodes]),
    supabase.from("purchase_orders").select("id, code").in("code", [...poCodes]),
    supabase.from("parts").select("id, sku").in("sku", [...skus]),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (posRes.error) throw posRes.error;
  if (partsRes.error) throw partsRes.error;
  const cardId = new Map((cardsRes.data ?? []).map((r) => [r.code, r.id]));
  const poId = new Map((posRes.data ?? []).map((r) => [r.code, r.id]));
  const partId = new Map((partsRes.data ?? []).map((r) => [r.sku, r.id]));

  function rowsFor(ws: Code, w: PlantedWorkshop): Row[] {
    const at = (path: string) => hrefWith(path, { ws });
    const card = (code: string): Item => ({ label: code, href: cardId.has(code) ? at(`/job-cards/${cardId.get(code)}`) : null });
    const po = (code: string): Item => ({ label: code, href: poId.has(code) ? at(`/purchasing/${poId.get(code)}`) : null });
    const part = (sku: string): Item => ({ label: sku, href: partId.has(sku) ? at(`/catalogue/parts/${partId.get(sku)}`) : null });
    const text = (label: string): Item => ({ label, href: null });
    const rows: Row[] = [
      ...w.chains.map((c) => ({
        scenario: t("planted.chain", { label: c.label }),
        items: [card(c.card_code), text(c.reg_no), po(c.po_code), part(c.sku)],
      })),
      { scenario: t("planted.poDueTomorrow"), items: [po(w.po_due_tomorrow)], list: { href: at("/store/receive"), label: t("planted.openList") } },
      { scenario: t("planted.poOverdue"), items: [po(w.po_overdue)] },
      { scenario: t("planted.poPartial"), items: [po(w.po_partially_received)] },
      {
        scenario: t("planted.receiving", { qty: w.receiving.qty, sku: w.receiving.sku }),
        items: w.receiving.reserved_for.map(card),
        list: { href: at("/store/putaway"), label: t("planted.openList") },
      },
      { scenario: t("planted.readyToIssue"), items: w.ready_to_issue.map(card), list: { href: at("/store/issue"), label: t("planted.openList") } },
      { scenario: t("planted.blockedInTransit"), items: w.blocked.in_transit.map(card), list: { href: at("/blocked"), label: t("planted.openList") } },
      { scenario: t("planted.blockedOverdue"), items: w.blocked.overdue_po.map(card) },
      { scenario: t("planted.blockedNotOrdered"), items: w.blocked.not_ordered.map(card) },
      ...(w.blocked.flagged_fitment.length > 0 ? [{ scenario: t("planted.blockedFlagged"), items: w.blocked.flagged_fitment.map(card) }] : []),
      {
        scenario: t("planted.inboundShortfall"),
        items: w.inbound_shortfall.map(card),
        list: { href: at("/blocked?tab=inbound"), label: t("planted.openList") },
      },
      { scenario: t("planted.lowStock"), items: w.low_stock_auto_skus.map(text), list: { href: at("/reorder"), label: t("planted.openList") } },
      { scenario: t("planted.deadStock"), items: w.dead_stock_skus.map(text), list: { href: at("/dead-stock"), label: t("planted.openList") } },
      { scenario: t("planted.emergencyBuys"), items: w.emergency_buy_cards.map(card), list: { href: at("/emergency"), label: t("planted.openList") } },
      { scenario: t("planted.unsourced"), items: [part(w.unsourced.sku), card(w.unsourced.card_code)] },
      { scenario: t("planted.unknownVariant"), items: [card(w.unknown_variant.card_code), text(w.unknown_variant.reg_no)] },
    ];
    if (w.flagged_fitment) {
      rows.push({
        scenario: t("planted.flaggedFitment", { variant: w.flagged_fitment.variant }),
        items: [part(w.flagged_fitment.sku), card(w.flagged_fitment.card_code)],
      });
    }
    return rows;
  }

  return (
    <>
      <PageHeader title={t("pages.planted")} subtitle={t("planted.intro")} />
      {WORKSHOPS.map((ws) => (
        <section key={ws} className="mb-6" aria-labelledby={`planted-${ws}`}>
          <h2 id={`planted-${ws}`} className="mb-2 text-lg font-semibold">
            {ws}
          </h2>
          <div className="overflow-x-auto rounded-xl border">
            <Table data-testid={`planted-${ws}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("planted.scenario")}</TableHead>
                  <TableHead>{t("planted.codes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsFor(ws, planted[ws]).map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="min-w-48 whitespace-normal">{row.scenario}</TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="flex flex-wrap gap-x-3 gap-y-1">
                        {row.items.map((item, j) =>
                          item.href ? (
                            <Link key={j} href={item.href} className="font-mono text-sm underline underline-offset-4">
                              {item.label}
                            </Link>
                          ) : (
                            <span key={j} className="font-mono text-sm">
                              {item.label}
                            </span>
                          ),
                        )}
                        {row.list && (
                          <Link href={row.list.href} className="text-sm font-medium underline underline-offset-4">
                            {row.list.label}
                          </Link>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
    </>
  );
}
