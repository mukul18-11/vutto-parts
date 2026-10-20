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
import { formatINR } from "@/lib/money";
import { premiumPercent } from "@/lib/store";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Emergency buy recorded · Vutto Parts" };

type Enums = Database["public"]["Enums"];
const WARNINGS = ["JOB_CARD_NOT_CONFIRMED", "LINE_CANCELLED", "BIKE_NOT_ARRIVED"] as const;

/**
 * Emergency buy success (SPEC §8.3, §14): reached with router.replace. Reads the persisted buy and
 * offers the compensating actions: return the issued part, or move the units left in receiving.
 */
export default async function EmergencyDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ lineId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ lineId }, sp] = await Promise.all([params, searchParams]);
  const { user, profile, workshop } = await requireRole("/store/emergency", sp);
  const buyId = z.guid().safeParse(sp.buy);
  if (!z.guid().safeParse(lineId).success || !buyId.success) notFound();
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  const warning = WARNINGS.find((w) => w === sp.warning) ?? null;

  const [buyRes, rcvRes, binsRes] = await Promise.all([
    supabase
      .from("v_emergency_buys_list")
      .select("id, job_card_line_id, job_card_id, card_code, reg_no, part_id, sku, part_name, uom, vendor_name, qty, unit_price_paise, reference_price_paise, total_paise, qty_issued, qty_to_stock")
      .eq("id", buyId.data)
      .eq("workshop_id", workshop.id)
      .maybeSingle(),
    supabase.from("bins").select("id, code").eq("workshop_id", workshop.id).eq("kind", "receiving").maybeSingle(),
    supabase.from("bins").select("id, code").eq("workshop_id", workshop.id).eq("kind", "normal").eq("is_active", true).order("code"),
  ]);
  for (const r of [buyRes, rcvRes, binsRes]) if (r.error) throw r.error;
  const buy = buyRes.data;
  if (!buy || buy.job_card_line_id !== lineId) notFound();
  const rcv = rcvRes.data;
  const balRes = rcv
    ? await supabase.from("stock_balances").select("on_hand").eq("bin_id", rcv.id).eq("part_id", buy.part_id as string).maybeSingle()
    : { data: null, error: null };
  if (balRes.error) throw balRes.error;

  const uomKey = buy.uom as Enums["uom"];
  const uom = t(`enums.uom.${uomKey}`);
  const price = Number(buy.unit_price_paise);
  const reference = buy.reference_price_paise === null ? null : Number(buy.reference_price_paise);
  const pct = premiumPercent(price, reference);
  const issued = buy.qty_issued ?? 0;
  const toStock = buy.qty_to_stock ?? 0;

  return (
    <>
      <PageHeader title={t("emergency.doneTitle")} subtitle={<AsOf />} />
      <div role="status" className="flex flex-col gap-2 rounded-xl bg-emerald-50 p-4 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50" data-testid="emergency-done">
        {issued > 0 && (
          <p className="text-base">
            {t("emergency.doneIssued", { n: issued, uom, sku: buy.sku ?? "", code: buy.card_code ?? "", reg: buy.reg_no ?? "" })}
          </p>
        )}
        {toStock > 0 && <p className="text-base">{t("emergency.doneStock", { n: toStock, uom, bin: rcv?.code ?? "" })}</p>}
        <p className="text-sm">{t("emergency.donePaid", { total: formatINR(Number(buy.total_paise)), vendor: buy.vendor_name ?? "" })}</p>
        {pct !== null && reference !== null && (
          <p className="text-sm">{t("emergency.donePremium", { premium: `${pct > 0 ? "+" : ""}${pct}%`, reference: formatINR(reference) })}</p>
        )}
      </div>
      {warning && (
        <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          {t(`emergency.warning.${warning}`)}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {issued > 0 && buy.job_card_id && (
          <Button asChild variant="outline" className="h-12 text-base sm:flex-1">
            <Link href={link(`/store/return/${buy.job_card_id}?line=${lineId}`)} data-testid="return-this">
              {t("issue.returnThis")}
            </Link>
          </Button>
        )}
        {toStock > 0 && rcv && (
          <div className="sm:flex-1">
            <MoveSheet
              userId={user.id}
              workshopCode={workshop.code}
              part={{ id: buy.part_id as string, sku: buy.sku ?? "", uom: uomKey }}
              from={{ id: rcv.id, code: rcv.code, on_hand: balRes.data?.on_hand ?? 0 }}
              bins={binsRes.data ?? []}
            />
          </div>
        )}
        <Button asChild variant="outline" className="h-12 text-base sm:flex-1">
          <Link href={link("/store/emergency")}>{t("emergency.backToList")}</Link>
        </Button>
      </div>
    </>
  );
}
