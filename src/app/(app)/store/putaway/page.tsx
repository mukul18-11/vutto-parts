import type { Metadata } from "next";
import { AsOf } from "@/components/as-of";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDuration, requestNow } from "@/lib/time";
import { PutawayList, type ReceivingItem } from "./putaway-form";

export const metadata: Metadata = { title: "Put away · Vutto Parts" };

type Uom = Database["public"]["Enums"]["uom"];

/** Stock in the receiving bin, oldest first, put away into a normal bin (SPEC §3.4 putaway). */
export default async function PutawayPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { user, workshop } = await requireRole("/store/putaway", sp);
  const t = await getT();
  const supabase = await createClient();

  const [itemsRes, binsRes] = await Promise.all([
    supabase
      .from("v_receiving_stock")
      .select("bin_id, part_id, sku, name, name_hi, uom, on_hand, oldest_in_at, reserved, reserved_for, suggested_bin_id, suggested_bin_code")
      .eq("workshop_id", workshop.id)
      .order("oldest_in_at", { ascending: true })
      .order("sku"),
    supabase
      .from("bins")
      .select("id, code")
      .eq("workshop_id", workshop.id)
      .eq("kind", "normal")
      .eq("is_active", true)
      .order("code"),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (binsRes.error) throw binsRes.error;

  const now = requestNow();
  const items: ReceivingItem[] = (itemsRes.data ?? []).map((r) => ({
    bin_id: r.bin_id as string,
    part_id: r.part_id as string,
    sku: r.sku as string,
    name: r.name as string,
    name_hi: r.name_hi,
    uom: r.uom as Uom,
    on_hand: r.on_hand as number,
    age: r.oldest_in_at ? formatDuration(r.oldest_in_at, now, t) : null,
    reserved: r.reserved ?? 0,
    reserved_for: (r.reserved_for ?? []) as ReceivingItem["reserved_for"],
    suggested: r.suggested_bin_id ? { id: r.suggested_bin_id, code: r.suggested_bin_code as string } : null,
  }));

  return (
    <>
      <PageHeader
        title={t("putaway.title")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
      />
      {/* Always mounted, so the result of the last putaway stays visible when the bin empties. */}
      <PutawayList userId={user.id} workshopCode={workshop.code} items={items} bins={binsRes.data ?? []} />
    </>
  );
}
