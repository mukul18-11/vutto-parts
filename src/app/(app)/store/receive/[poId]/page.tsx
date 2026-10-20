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
  const { user, profile, workshop } = await requireRole("/store/receive", sp);
  if (!z.guid().safeParse(poId).success) notFound();
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const poRes = await supabase
    .from("v_po_list")
    .select("id, workshop_id, code, status, supplier_name")
    .eq("id", poId)
    .eq("workshop_id", workshop.id)
    .maybeSingle();
  if (poRes.error) throw poRes.error;
  const po = poRes.data;
  if (!po) notFound();

  const receivable = po.status === "sent" || po.status === "partially_received";
  const [linesRes, rcvRes] = await Promise.all([
    supabase
      .from("po_lines")
      .select("id, unit_price_paise, open_qty, parts(sku, name, name_hi, uom)")
      .eq("po_id", po.id as string)
      .gt("open_qty", 0),
    supabase.from("bins").select("code").eq("workshop_id", workshop.id).eq("kind", "receiving").maybeSingle(),
  ]);
  if (linesRes.error) throw linesRes.error;
  if (rcvRes.error) throw rcvRes.error;

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
        rcvBinCode={rcvRes.data?.code ?? `${workshop.code}-RCV`}
        links={{ list: link("/store/receive"), putaway: link("/store/putaway"), issue: link("/store/issue/{id}") }}
      />
    </>
  );
}
