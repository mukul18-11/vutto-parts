import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AsOf } from "@/components/as-of";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Issued · Vutto Parts" };

type Uom = Database["public"]["Enums"]["uom"];

/**
 * Issue success (SPEC §14): reached with router.replace, so Back never resubmits. States what the
 * persisted issue move did and offers the compensating action (return this part).
 */
export default async function IssueDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ cardId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ cardId }, sp] = await Promise.all([params, searchParams]);
  const moveId = z.coerce.number().int().positive().safeParse(sp.move);
  if (!z.guid().safeParse(cardId).success || !moveId.success) notFound();
  const supabase = await createClient();

  // Two sequential round trips: the move runs with the route guard (RLS scopes it; the workshop
  // is checked once the guard resolves), then the line, bin and balance it points to.
  const [{ profile, workshop }, t, moveRes] = await Promise.all([
    requireRole("/store/issue", sp),
    getT(),
    supabase
      .from("stock_moves")
      .select("id, workshop_id, move_type, qty, from_bin_id, job_card_line_id, part_id")
      .eq("id", moveId.data)
      .eq("move_type", "issue")
      .maybeSingle(),
  ]);
  if (moveRes.error) throw moveRes.error;
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  const move = moveRes.data;
  if (!move || move.workshop_id !== workshop.id || !move.job_card_line_id || !move.from_bin_id) notFound();

  const [lineRes, binRes, balRes] = await Promise.all([
    supabase
      .from("job_card_lines")
      .select("id, job_card_id, qty_required, qty_reserved, qty_issued, qty_returned, part:parts(sku, name, uom), card:job_cards(code, bike:bikes(reg_no))")
      .eq("id", move.job_card_line_id)
      .maybeSingle(),
    supabase.from("bins").select("code").eq("id", move.from_bin_id).maybeSingle(),
    supabase.from("stock_balances").select("on_hand").eq("bin_id", move.from_bin_id).eq("part_id", move.part_id).maybeSingle(),
  ]);
  for (const r of [lineRes, binRes, balRes]) if (r.error) throw r.error;
  const line = lineRes.data;
  if (!line || line.job_card_id !== cardId) notFound();
  const part = line.part as { sku: string; name: string; uom: Uom };
  const card = line.card as { code: string; bike: { reg_no: string } | null };
  const uom = t(`enums.uom.${part.uom}`);
  const binCode = binRes.data?.code ?? "";

  return (
    <>
      <PageHeader title={t("issue.doneTitle")} subtitle={<AsOf />} />
      <div role="status" className="flex flex-col gap-2 rounded-xl bg-emerald-50 p-4 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50" data-testid="issue-done">
        <p className="text-base font-medium">
          {t("issue.done", {
            qty: move.qty,
            uom,
            sku: part.sku,
            code: card.code,
            reg: card.bike?.reg_no ?? "",
            bin: binCode,
            left: balRes.data?.on_hand ?? 0,
          })}
        </p>
        <p className="text-sm">{part.name}</p>
        <p className="text-sm">
          {t("issue.doneLine", {
            issued: line.qty_issued - line.qty_returned,
            reserved: line.qty_reserved,
            required: line.qty_required,
          })}
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button asChild className="h-12 text-base sm:flex-1">
          <Link href={link(`/store/issue/${cardId}`)} data-testid="issue-next">
            {t("issue.issueNext")}
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-12 text-base sm:flex-1">
          <Link href={link(`/store/return/${cardId}?line=${line.id}`)} data-testid="return-this">
            {t("issue.returnThis")}
          </Link>
        </Button>
      </div>
    </>
  );
}
