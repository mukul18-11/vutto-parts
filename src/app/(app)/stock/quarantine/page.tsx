import type { Metadata } from "next";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatIST } from "@/lib/time";
import { MoveBack, ReturnToSupplier } from "./quarantine-actions";

export const metadata: Metadata = { title: "Quarantine · Vutto Parts" };

type Uom = Database["public"]["Enums"]["uom"];

/** Quarantine stock (never usable, SPEC §4): move back after re-inspection, or return to supplier. */
export default async function QuarantinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { user, workshop } = await requireRole("/stock/quarantine", sp);
  const t = await getT();
  const supabase = await createClient();

  const [itemsRes, binsRes] = await Promise.all([
    supabase
      .from("v_quarantine_stock")
      .select("bin_id, bin_code, part_id, sku, name, name_hi, uom, on_hand, last_in_at, last_move_type, last_reason, last_note, last_user_name")
      .eq("workshop_id", workshop.id)
      .order("last_in_at", { ascending: true }),
    supabase.from("bins").select("id, code").eq("workshop_id", workshop.id).eq("kind", "normal").eq("is_active", true).order("code"),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (binsRes.error) throw binsRes.error;
  const items = itemsRes.data ?? [];

  return (
    <>
      <PageHeader
        title={t("quarantine.title")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
      />
      {items.length === 0 ? (
        <EmptyState message={t("quarantine.empty")} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="quarantine-list">
          {items.map((q) => {
            const item = {
              bin_id: q.bin_id as string,
              bin_code: q.bin_code as string,
              part_id: q.part_id as string,
              sku: q.sku as string,
              uom: q.uom as Uom,
              on_hand: q.on_hand as number,
            };
            return (
              <li key={`${q.bin_id}:${q.part_id}`} className="flex flex-col gap-2 rounded-xl border p-3" data-testid={`quarantine-${q.sku}`}>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{q.sku}</span>
                  <span className="font-semibold tabular-nums">{`${q.on_hand} ${t(`enums.uom.${item.uom}`)}`}</span>
                  <span className="font-mono text-xs text-muted-foreground">{q.bin_code}</span>
                </p>
                <p className="break-words">{q.name}</p>
                {q.name_hi && <p className="text-sm text-muted-foreground">{q.name_hi}</p>}
                {q.last_in_at && (
                  <p className="text-sm text-muted-foreground">
                    {[
                      formatIST(q.last_in_at),
                      q.last_move_type && t(`enums.move_type.${q.last_move_type as Database["public"]["Enums"]["move_type"]}`),
                      q.last_user_name,
                      q.last_reason,
                      q.last_note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <MoveBack userId={user.id} workshopCode={workshop.code} item={item} bins={binsRes.data ?? []} />
                  <ReturnToSupplier userId={user.id} item={item} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
