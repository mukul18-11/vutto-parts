import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AsOf } from "@/components/as-of";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatIST, requestNow } from "@/lib/time";
import { CountSheet, type CountItem } from "./count-form";

export const metadata: Metadata = { title: "Count bin · Vutto Parts" };

type Uom = Database["public"]["Enums"]["uom"];

/** Count one bin: expected on hand is captured when this page renders (SPEC §8.4 STALE_COUNT). */
export default async function CountBinPage({
  params,
  searchParams,
}: {
  params: Promise<{ binId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ binId }, sp] = await Promise.all([params, searchParams]);
  if (!z.guid().safeParse(binId).success) notFound();
  const supabase = await createClient();

  // One round trip with the route guard: the bin and its balances are keyed by the bin id (RLS
  // scopes them; the workshop is checked once the guard resolves). STALE_COUNT compares against
  // these balances, so the load time is taken before reading them.
  const loadedAt = new Date(requestNow()).toISOString();
  const [{ user, workshop }, t, binRes, balRes] = await Promise.all([
    requireRole("/stock/count", sp),
    getT(),
    supabase.from("bins").select("id, workshop_id, code, kind, count_requested_at").eq("id", binId).maybeSingle(),
    supabase.from("stock_balances").select("part_id, on_hand, parts(sku, name, name_hi, uom)").eq("bin_id", binId),
  ]);
  if (binRes.error) throw binRes.error;
  if (balRes.error) throw balRes.error;
  const bin = binRes.data;
  if (!bin || bin.workshop_id !== workshop.id) notFound();

  const items: CountItem[] = (balRes.data ?? [])
    .map((b) => {
      const p = b.parts as { sku: string; name: string; name_hi: string | null; uom: Uom };
      return { part_id: b.part_id, sku: p.sku, name: p.name, name_hi: p.name_hi, uom: p.uom, expected: b.on_hand };
    })
    .sort((a, b) => (b.expected > 0 ? 1 : 0) - (a.expected > 0 ? 1 : 0) || a.sku.localeCompare(b.sku));

  return (
    <>
      <PageHeader
        title={t("count.binTitle", { code: bin.code })}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            {bin.count_requested_at && <span>{t("count.requestedAt", { at: formatIST(bin.count_requested_at) })}</span>}
            <AsOf at={loadedAt} />
          </span>
        }
      />
      <CountSheet
        userId={user.id}
        workshopId={workshop.id}
        bin={{ id: bin.id, code: bin.code }}
        items={items}
        loadedAt={loadedAt}
      />
    </>
  );
}
