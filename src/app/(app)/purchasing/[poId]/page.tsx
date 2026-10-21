import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { formatINR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { addDaysIST, formatDateOnly, formatIST, istToday } from "@/lib/time";
import { AddDraftLine, CancelPo, DraftLineRow, ExpectedOnEdit, SendPoArea, ShortClose } from "./po-actions";

export const metadata: Metadata = { title: "Purchase order · Vutto Parts" };

type PoStatus = Database["public"]["Enums"]["po_status"];
type Uom = Database["public"]["Enums"]["uom"];

export default async function PoPage({
  params,
  searchParams,
}: {
  params: Promise<{ poId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ poId }, sp] = await Promise.all([params, searchParams]);
  if (!z.guid().safeParse(poId).success) notFound();
  const supabase = await createClient();

  // The PO, its lines and GRNs run with the route guard (RLS scopes them); only a draft needs a
  // second round trip, for the reorder suggestions of its workshop.
  const [{ user, profile, workshop }, t, poRes, linesRes, grnRes] = await Promise.all([
    requireRole("/purchasing", sp),
    getT(),
    supabase
      .from("v_po_list")
      .select(
        "id, workshop_id, code, status, supplier_id, supplier_name, supplier_phone, lead_time_days, sent_at, expected_on, cancel_reason, is_overdue, line_count, qty_accepted, open_qty, total_paise, missing_price_count",
      )
      .eq("id", poId)
      .maybeSingle(),
    supabase
      .from("po_lines")
      .select(
        "id, part_id, qty_ordered, qty_accepted, qty_rejected, qty_cancelled, open_qty, unit_price_paise, source, parts(sku, name, name_hi, uom, oem_part_no)",
      )
      .eq("po_id", poId),
    supabase
      .from("v_grn_list")
      .select("id, code, supplier_invoice_no, invoice_date, received_by_name, received_at, qty_received, qty_accepted, qty_rejected, accepted_value_paise")
      .eq("po_id", poId)
      .order("received_at", { ascending: false }),
  ]);
  for (const res of [poRes, linesRes, grnRes]) if (res.error) throw res.error;
  const po = poRes.data;
  // Admin sees every workshop; the page stays on the PO's own workshop.
  if (!po || (profile.role !== "admin" && po.workshop_id !== workshop.id)) notFound();
  const status = po.status as PoStatus;
  const isDraft = status === "draft";
  const isOpen = status === "sent" || status === "partially_received";

  const suggRes = isDraft
    ? await supabase.rpc("reorder_suggestions", { p_workshop_id: po.workshop_id as string })
    : { data: [], error: null };
  if (suggRes.error) throw suggRes.error;

  const lines = (linesRes.data ?? [])
    .map((l) => ({ ...l, part: l.parts as { sku: string; name: string; name_hi: string | null; uom: Uom; oem_part_no: string | null } }))
    .sort((a, b) => a.part.sku.localeCompare(b.part.sku));
  const suggestion = new Map((suggRes.data ?? []).map((s) => [s.part_id, s]));
  const today = istToday();
  const yesterday = addDaysIST(today, -1);
  const poSummary = {
    id: po.id as string,
    code: po.code as string,
    status,
    supplier_name: po.supplier_name as string,
    supplier_phone: po.supplier_phone,
    line_count: po.line_count ?? 0,
    total_paise: Number(po.total_paise ?? 0),
    missing_price_count: po.missing_price_count ?? 0,
    expected_preview: addDaysIST(today, po.lead_time_days ?? 0),
    qty_accepted: po.qty_accepted ?? 0,
  };

  return (
    <>
      <PageHeader
        title={po.code as string}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge enum="po_status" value={status} />
            {po.is_overdue && <Badge variant="destructive">{t("purchasing.overdue")}</Badge>}
            <span>{po.supplier_name}</span>
            <span>{t("purchasing.leadTime", { days: po.lead_time_days ?? 0 })}</span>
          </span>
        }
      />

      {/* Kept at the same position for draft and sent, so the WhatsApp text survives the refresh. */}
      <SendPoArea userId={user.id} po={poSummary} />

      <section className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>{t("purchasing.totalInclGst", { total: formatINR(poSummary.total_paise) })}</span>
        {po.sent_at && <span>{t("purchasing.sentAt", { at: formatIST(po.sent_at) })}</span>}
        {po.expected_on && <span>{t("purchasing.expectedOn", { date: formatDateOnly(po.expected_on) })}</span>}
        {po.cancel_reason && <span>{t("purchasing.cancelReason", { reason: po.cancel_reason })}</span>}
      </section>

      {isOpen && po.expected_on && (
        <ExpectedOnEdit userId={user.id} poId={poSummary.id} current={po.expected_on} today={today} />
      )}

      <h2 className="mb-2 text-lg font-semibold">{t("purchasing.lines")}</h2>
      {lines.length === 0 ? (
        <EmptyState message={t("purchasing.noLines")} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="po-lines">
          {lines.map((l) => {
            const s = suggestion.get(l.part_id);
            return isDraft ? (
              <DraftLineRow
                key={l.id}
                userId={user.id}
                line={{
                  id: l.id,
                  sku: l.part.sku,
                  name: l.part.name,
                  name_hi: l.part.name_hi,
                  uom: l.part.uom,
                  qty: l.qty_ordered,
                  unit_price_paise: l.unit_price_paise,
                  source: l.source,
                }}
                why={
                  s
                    ? {
                        usable: s.usable_on_hand,
                        onOrder: s.on_order,
                        demand: s.outstanding_demand,
                        projected: s.projected,
                        rop: s.rop,
                        avgDaily: Number(s.avg_daily_issue_28d).toFixed(2),
                        isAuto: s.is_auto,
                        enoughHistory: s.enough_history,
                        orderQty: s.order_qty,
                        yesterday: formatDateOnly(yesterday),
                      }
                    : null
                }
              />
            ) : (
              <li key={l.id} className="rounded-xl border p-3" data-testid={`po-line-${l.part.sku}`}>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{l.part.sku}</span>
                  <span className="break-words">{l.part.name}</span>
                </p>
                {l.part.name_hi && <p className="text-sm text-muted-foreground">{l.part.name_hi}</p>}
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
                  {(
                    [
                      ["ordered", l.qty_ordered],
                      ["accepted", l.qty_accepted],
                      ["rejected", l.qty_rejected],
                      ["cancelled", l.qty_cancelled],
                      ["open", l.open_qty],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted-foreground">{t(`purchasing.qty_${k}`)}</dt>
                      <dd className="tabular-nums" data-testid={`qty-${k}`}>
                        {`${v ?? 0} ${t(`enums.uom.${l.part.uom}`)}`}
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("purchasing.unitPrice")}</dt>
                    <dd className="tabular-nums">{l.unit_price_paise ? formatINR(Number(l.unit_price_paise)) : "–"}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      {isDraft && <AddDraftLine userId={user.id} workshopId={po.workshop_id as string} supplierId={po.supplier_id as string} />}

      {!isDraft && (
        <section className="mt-6" aria-labelledby="grns-title">
          <h2 id="grns-title" className="mb-2 text-lg font-semibold">
            {t("purchasing.grns")}
          </h2>
          {(grnRes.data ?? []).length === 0 ? (
            <EmptyState message={t("purchasing.noGrns")} />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="grn-list">
              {(grnRes.data ?? []).map((g) => (
                <li key={g.id} className="rounded-xl border p-3 text-sm">
                  <p className="flex flex-wrap gap-x-3">
                    <span className="font-mono font-medium">{g.code}</span>
                    <span>{t("purchasing.invoice", { no: g.supplier_invoice_no ?? "", date: g.invoice_date ? formatDateOnly(g.invoice_date) : "" })}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {t("purchasing.receivedBy", { name: g.received_by_name ?? "–", at: g.received_at ? formatIST(g.received_at) : "" })}
                  </p>
                  <p>
                    {t("purchasing.grnQty", {
                      received: g.qty_received ?? 0,
                      accepted: g.qty_accepted ?? 0,
                      rejected: g.qty_rejected ?? 0,
                      value: formatINR(Number(g.accepted_value_paise ?? 0)),
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-6 flex flex-wrap gap-2">
        {isOpen && (po.open_qty ?? 0) > 0 && (
          <ShortClose
            userId={user.id}
            poId={poSummary.id}
            lines={lines
              .filter((l) => (l.open_qty ?? 0) > 0)
              .map((l) => ({ id: l.id, sku: l.part.sku, open: l.open_qty ?? 0, uom: l.part.uom }))}
          />
        )}
        {(isDraft || (status === "sent" && poSummary.qty_accepted === 0)) && (
          <CancelPo userId={user.id} po={poSummary} listHref={withWs("/purchasing", profile.role, workshop.code)} />
        )}
        {status === "partially_received" && <p className="text-sm text-muted-foreground">{t("purchasing.useShortClose")}</p>}
      </section>
    </>
  );
}
