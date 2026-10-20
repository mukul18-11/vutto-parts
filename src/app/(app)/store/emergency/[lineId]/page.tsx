import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AsOf } from "@/components/as-of";
import { EtaBadge } from "@/components/eta-badge";
import { RemountOnRestore } from "@/components/remount-on-restore";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { formatINR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { bikeLabel } from "../../card-finder";
import { EmergencyForm } from "./emergency-form";

export const metadata: Metadata = { title: "Emergency buy · Vutto Parts" };

type Enums = Database["public"]["Enums"];
type HeldBin = { bin_id: string; code: string; kind: string; on_hand: number };
type Holder = { card_code: string; reg_no: string; qty: number };

/**
 * Emergency buy for one line (SPEC §8.3): the remaining need, a warning when stock exists (reserved
 * for this bike: issue it instead; held by another bike: ask the manager to reallocate), the ETA,
 * then vendor, qty, price with the live premium, reason and note. Reached from the issue screen,
 * the store's emergency list and (managers) the blocked board. No bill photo (out of scope).
 */
export default async function EmergencyBuyPage({
  params,
  searchParams,
}: {
  params: Promise<{ lineId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ lineId }, sp] = await Promise.all([params, searchParams]);
  const { user, profile, workshop } = await requireRole("/store/emergency", sp);
  if (!z.guid().safeParse(lineId).success) notFound();
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const [lineRes, ctxRes, etaRes, rcvRes] = await Promise.all([
    supabase
      .from("job_card_lines")
      .select(
        "id, cancelled_at, part:parts(sku, name, name_hi, uom), card:job_cards(id, code, status, bike:bikes(reg_no, status, mfg_year, model:vehicle_models(make, model), variant:model_variants(name)))",
      )
      .eq("id", lineId)
      .eq("workshop_id", workshop.id)
      .maybeSingle(),
    supabase.rpc("emergency_context", { p_line_id: lineId }).maybeSingle(),
    supabase.from("v_line_eta").select("eta_status, po_code, expected_on, is_overdue").eq("line_id", lineId).maybeSingle(),
    supabase.from("bins").select("code").eq("workshop_id", workshop.id).eq("kind", "receiving").maybeSingle(),
  ]);
  for (const r of [lineRes, ctxRes, etaRes, rcvRes]) if (r.error) throw r.error;
  const line = lineRes.data;
  const ctx = ctxRes.data;
  if (!line || !ctx || !line.card?.bike) notFound();
  const part = line.part as { sku: string; name: string; name_hi: string | null; uom: Enums["uom"] };
  const card = line.card;
  const bike = card.bike!;
  const uom = t(`enums.uom.${part.uom}`);
  const reservedBins = (ctx.reserved_bins ?? []) as HeldBin[];
  const heldBy = (ctx.held_by ?? []) as Holder[];

  const why =
    card.status !== "confirmed"
      ? t("issue.whyCard", { status: t(`enums.job_card_status.${card.status}`) })
      : line.cancelled_at
        ? t("enums.line_status.cancelled")
        : bike.status !== "at_workshop" && bike.status !== "in_repair"
          ? t("issue.whyBike", { status: t(`enums.bike_status.${bike.status}`) })
          : null;
  const remaining = why ? 0 : ctx.remaining_need;
  // Free stock held by other bikes matters only when this bike's need is not reserved already.
  const showHeld = ctx.qty_reserved === 0 && ctx.available <= 0 && heldBy.length > 0;
  const reference = ctx.reference_price_paise === null ? null : Number(ctx.reference_price_paise);

  return (
    <>
      <header className="mb-4 flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("emergency.title", { sku: part.sku })}</h1>
        <p className="break-words">{part.name}</p>
        {part.name_hi && <p className="text-sm text-muted-foreground">{part.name_hi}</p>}
        <p className="font-mono text-2xl font-bold">{bike.reg_no}</p>
        <p className="text-sm">
          {bikeLabel(
            { make: bike.model?.make ?? null, model: bike.model?.model ?? null, variant_name: bike.variant?.name ?? null, mfg_year: bike.mfg_year },
            t,
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span className="font-mono">{card.code}</span>
          <AsOf />
        </p>
      </header>

      <section className="mb-4 flex flex-col gap-2" aria-live="polite">
        <p className="text-lg font-semibold tabular-nums" data-testid="remaining-need">
          {why ? t("emergency.toStockOnly", { why }) : remaining > 0 ? t("emergency.remaining", { qty: remaining, uom }) : t("emergency.nothingNeeded")}
        </p>
        {etaRes.data && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <EtaBadge part={etaRes.data} t={t} />
          </p>
        )}
        {ctx.qty_reserved > 0 && reservedBins.length > 0 && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50" data-testid="reserved-here">
            <p>
              {t("emergency.reservedHere", {
                qty: ctx.qty_reserved,
                uom,
                bin: reservedBins.map((b) => b.code).join(", "),
              })}
            </p>
            <Button asChild variant="outline" className="h-12 text-base">
              <Link href={link(`/store/issue/${card.id}`)}>{t("emergency.issueInstead")}</Link>
            </Button>
          </div>
        )}
        {showHeld && (
          <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50" data-testid="held-by-other">
            {t("emergency.heldBy", {
              list: heldBy
                .slice(0, 3)
                .map((h) => `${h.card_code} (${h.reg_no})`)
                .join(", "),
            })}
          </p>
        )}
        {reference !== null && (
          <p className="text-sm text-muted-foreground">{t("emergency.reference", { price: formatINR(reference) })}</p>
        )}
      </section>

      <RemountOnRestore>
        <EmergencyForm
          userId={user.id}
          lineId={line.id}
          part={{ sku: part.sku, uom: part.uom }}
          card={{ code: card.code, reg: bike.reg_no }}
          remainingNeed={remaining}
          cardOk={why === null}
          referencePaise={reference}
          receivingCode={rcvRes.data?.code ?? `${workshop.code}-RCV`}
          doneHref={link(`/store/emergency/${line.id}/done?buy={buy}&warning={warning}`)}
        />
      </RemountOnRestore>
    </>
  );
}
