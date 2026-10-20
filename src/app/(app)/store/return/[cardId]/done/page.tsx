import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AsOf } from "@/components/as-of";
import { MoveSheet } from "@/components/move-sheet";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { isReturnReason, returnEffects } from "@/lib/store";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Returned · Vutto Parts" };

type Enums = Database["public"]["Enums"];
const count = z.coerce.number().int().min(0).max(9999).catch(0);

/**
 * Return success (SPEC §8.2, §14): reached with router.replace. States the effect from the
 * persisted return move and the line's state now ("Need reopened; 1 set reserved again for this
 * bike"); again/others come from the RPC result's allocations. Offers "Move to another bin".
 */
export default async function ReturnDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ cardId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ cardId }, sp] = await Promise.all([params, searchParams]);
  const { user, profile, workshop } = await requireRole("/store/return", sp);
  const moveId = z.coerce.number().int().positive().safeParse(sp.move);
  if (!z.guid().safeParse(cardId).success || !moveId.success) notFound();
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const moveRes = await supabase
    .from("stock_moves")
    .select("id, move_type, qty, to_bin_id, job_card_line_id, part_id, reason")
    .eq("id", moveId.data)
    .eq("workshop_id", workshop.id)
    .in("move_type", ["return_to_stock", "return_to_quarantine"])
    .maybeSingle();
  if (moveRes.error) throw moveRes.error;
  const move = moveRes.data;
  if (!move || !move.job_card_line_id || !move.to_bin_id || !isReturnReason(move.reason)) notFound();

  const [lineRes, binRes, balRes, binsRes] = await Promise.all([
    supabase
      .from("job_card_lines")
      .select("id, job_card_id, status, part:parts(sku, name, uom)")
      .eq("id", move.job_card_line_id)
      .maybeSingle(),
    supabase.from("bins").select("id, code, kind").eq("id", move.to_bin_id).maybeSingle(),
    supabase.from("stock_balances").select("on_hand").eq("bin_id", move.to_bin_id).eq("part_id", move.part_id).maybeSingle(),
    supabase.from("bins").select("id, code").eq("workshop_id", workshop.id).eq("kind", "normal").eq("is_active", true).order("code"),
  ]);
  for (const r of [lineRes, binRes, balRes, binsRes]) if (r.error) throw r.error;
  const line = lineRes.data;
  const bin = binRes.data;
  if (!line || line.job_card_id !== cardId || !bin) notFound();
  const part = line.part as { sku: string; name: string; uom: Enums["uom"] };
  const uom = t(`enums.uom.${part.uom}`);
  const effects = returnEffects(move.reason, {
    qty: move.qty,
    uom,
    sku: part.sku,
    bin: bin.code,
    again: count.parse(sp.again),
    others: count.parse(sp.others),
  });

  return (
    <>
      <PageHeader title={t("returns.doneTitle")} subtitle={<AsOf />} />
      <div role="status" className="flex flex-col gap-2 rounded-xl bg-emerald-50 p-4 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50" data-testid="return-done">
        {effects.map((e) => (
          <p key={e.key} className="text-base">
            {t(e.key, e.vars)}
          </p>
        ))}
        <p className="text-sm" data-testid="return-line-status" data-status={line.status}>
          {t("returns.lineNow", { status: t(`enums.line_status.${line.status as Enums["line_status"]}`) })}
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {bin.kind === "normal" && (
          <div className="sm:flex-1">
            <MoveSheet
              userId={user.id}
              workshopCode={workshop.code}
              part={{ id: move.part_id, sku: part.sku, uom: part.uom }}
              from={{ id: bin.id, code: bin.code, on_hand: balRes.data?.on_hand ?? 0 }}
              bins={binsRes.data ?? []}
            />
          </div>
        )}
        <Button asChild variant="outline" className="h-12 text-base sm:flex-1">
          <Link href={link(`/store/issue/${cardId}`)} data-testid="back-to-issue">
            {t("returns.backToIssue")}
          </Link>
        </Button>
      </div>
    </>
  );
}
