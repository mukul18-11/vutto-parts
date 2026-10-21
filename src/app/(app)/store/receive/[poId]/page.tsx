import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { istToday } from "@/lib/time";
import { ReceiveForm } from "./receive-form";

export const metadata: Metadata = { title: "Receive PO · Vutto Parts" };

type Uom = Database["public"]["Enums"]["uom"];

export default async function ReceivePoPage({
  params,
  searchParams,
}: {
  params: Promise<{ poId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ poId }, sp] = await Promise.all([params, searchParams]);
  if (!z.guid().safeParse(poId).success) notFound();
  const supabase = await createClient();

  // One round trip with the route guard: the PO, its open lines and the receiving bins are read
  // together (RLS scopes them; the workshop is checked once the guard resolves).
  const [{ user, profile, workshop }, t, poRes, linesRes, rcvRes] = await Promise.all([
    requireRole("/store/receive", sp),
    getT(),
    supabase.from("v_po_list").select("id, workshop_id, code, status, supplier_name").eq("id", poId).maybeSingle(),
    supabase
      .from("po_lines")
      .select("id, unit_price_paise, open_qty, parts(sku, name, name_hi, uom)")
      .eq("po_id", poId)
      .gt("open_qty", 0),
    supabase.from("bins").select("code, workshop_id").eq("kind", "receiving"),
  ]);
  for (const res of [poRes, linesRes, rcvRes]) if (res.error) throw res.error;
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  const po = poRes.data;
  if (!po || po.workshop_id !== workshop.id) notFound();
  const rcvBin = (rcvRes.data ?? []).find((b) => b.workshop_id === workshop.id);

  const receivable = po.status === "sent" || po.status === "partially_received";
  // Blind receiving: the form never gets the ordered or open quantity.
  const lines = (linesRes.data ?? [])
    .map((l) => {
      const part = l.parts as { sku: string; name: string; name_hi: string | null; uom: Uom };
      return { id: l.id, sku: part.sku, name: part.name, name_hi: part.name_hi, uom: part.uom, price_paise: Number(l.unit_price_paise) };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));

  return (
    <>
      <PageHeader title={t("receive.poTitle", { code: po.code as string })} subtitle={po.supplier_name} />
      {/* Always mounted: after posting, the refresh finds the PO received, and the form keeps
          its success screen instead of being replaced by the empty state. */}
      <ReceiveForm
        userId={user.id}
        po={{ id: po.id as string, code: po.code as string }}
        receivable={receivable && lines.length > 0}
        lines={lines}
        today={istToday()}
        rcvBinCode={rcvBin?.code ?? `${workshop.code}-RCV`}
        links={{ list: link("/store/receive"), putaway: link("/store/putaway"), issue: link("/store/issue/{id}") }}
      />
    </>
  );
}
