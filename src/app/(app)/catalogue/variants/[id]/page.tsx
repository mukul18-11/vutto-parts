import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { formatIST } from "@/lib/time";
import { FitmentDialog } from "../../forms";

export const metadata: Metadata = { title: "Fitments · Vutto Parts" };

export default async function VariantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { user, profile, workshop } = await requireRole("/catalogue", sp);
  if (!z.guid().safeParse(id).success) notFound();
  const t = await getT();
  const supabase = await createClient();
  const [variantRes, fitRes] = await Promise.all([
    supabase
      .from("model_variants")
      .select("id, name, year_from, year_to, model:vehicle_models(id, make, model)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("part_fitments")
      .select(
        "part_id, qty_per_bike, source, confirmed_count, flagged_count, last_flag_note, last_flagged_at, part:parts(sku, name, uom, is_active)",
      )
      .eq("variant_id", id),
  ]);
  if (variantRes.error) throw variantRes.error;
  if (fitRes.error) throw fitRes.error;
  const variant = variantRes.data;
  if (!variant || !variant.model) notFound();
  const admin = profile.role === "admin";
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  const fitments = fitRes.data.filter((f) => f.part).sort((a, b) => a.part!.sku.localeCompare(b.part!.sku));

  return (
    <>
      <PageHeader
        title={`${variant.model.make} ${variant.model.model} ${variant.name}`}
        subtitle={`${variant.year_from}–${variant.year_to ?? t("catalogue.stillSold")}`}
        actions={admin && <FitmentDialog userId={user.id} variantId={variant.id} workshopId={workshop.id} />}
      />
      <h2 className="mb-2 text-lg font-semibold">{t("catalogue.fitments")}</h2>
      {fitments.length === 0 ? (
        <EmptyState message={t("catalogue.noFitments")} />
      ) : (
        <ul className="rounded-xl border">
          {fitments.map((f) => {
            const red = f.flagged_count >= Math.max(1, f.confirmed_count);
            return (
              <li key={f.part_id} className="flex flex-wrap items-center justify-between gap-2 border-b p-3 last:border-b-0">
                <span className="min-w-0">
                  <Link href={link(`/catalogue/parts/${f.part_id}`)} className="underline-offset-4 hover:underline">
                    <span className="font-mono text-sm">{f.part!.sku}</span> <span className="break-words">{f.part!.name}</span>
                  </Link>
                  <span className="block text-sm text-muted-foreground">
                    {t("catalogue.perBike", { n: f.qty_per_bike, uom: t(`enums.uom.${f.part!.uom}`) })} ·{" "}
                    {t(`enums.fitment_source.${f.source}`)} ·{" "}
                    {t("jobCard.counts", { confirmed: f.confirmed_count, flagged: f.flagged_count })}
                  </span>
                  {f.last_flag_note && (
                    <span className="block text-sm text-destructive break-words">
                      {t("catalogue.lastFlag", { note: f.last_flag_note, at: f.last_flagged_at ? formatIST(f.last_flagged_at) : "" })}
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {red && <Badge className="bg-red-100 text-red-900">{t("fit.red")}</Badge>}
                  {admin && (
                    <FitmentDialog
                      userId={user.id}
                      variantId={variant.id}
                      workshopId={workshop.id}
                      fitment={{ part_id: f.part_id, sku: f.part!.sku, uom: f.part!.uom, qty_per_bike: f.qty_per_bike }}
                    />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Link href={link(`/catalogue/models/${variant.model.id}`)} className="mt-3 inline-block text-sm underline underline-offset-4">
        {t("catalogue.back")}
      </Link>
    </>
  );
}
