import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { ModelDialog, VariantDialog } from "../../forms";

export const metadata: Metadata = { title: "Model · Vutto Parts" };

export default async function ModelPage({
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
  const [modelRes, variantsRes] = await Promise.all([
    supabase.from("vehicle_models").select("id, make, model, segment").eq("id", id).maybeSingle(),
    supabase
      .from("model_variants")
      .select("id, model_id, name, year_from, year_to, brake_front, brake_rear, start_type, wheels, emission, fuel")
      .eq("model_id", id)
      .order("year_from")
      .order("name"),
  ]);
  if (modelRes.error) throw modelRes.error;
  if (variantsRes.error) throw variantsRes.error;
  const model = modelRes.data;
  if (!model) notFound();
  const admin = profile.role === "admin";
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  return (
    <>
      <PageHeader
        title={`${model.make} ${model.model}`}
        subtitle={t(`enums.vehicle_segment.${model.segment}`)}
        actions={admin && <ModelDialog userId={user.id} model={model} />}
      />
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("catalogue.variants")}</h2>
          {admin && <VariantDialog userId={user.id} modelId={model.id} />}
        </div>
        {variantsRes.data.length === 0 ? (
          <EmptyState message={t("catalogue.noVariants")} />
        ) : (
          <ul className="rounded-xl border">
            {variantsRes.data.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-b p-3 last:border-b-0">
                <span className="min-w-0">
                  <Link href={link(`/catalogue/variants/${v.id}`)} className="font-medium underline-offset-4 hover:underline">
                    {v.name}
                  </Link>{" "}
                  <span className="text-sm text-muted-foreground">
                    {v.year_from}–{v.year_to ?? t("catalogue.stillSold")}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {t("catalogue.brakes", {
                      front: t(`enums.brake_type.${v.brake_front}`),
                      rear: t(`enums.brake_type.${v.brake_rear}`),
                    })}{" "}
                    · {t(`enums.start_type.${v.start_type}`)} · {t(`enums.wheel_type.${v.wheels}`)} ·{" "}
                    {t(`enums.emission_norm.${v.emission}`)} · {t(`enums.fuel_system.${v.fuel}`)}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {admin && <VariantDialog userId={user.id} modelId={model.id} variant={v} />}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href={link("/catalogue?tab=models")} className="text-sm underline underline-offset-4">
          {t("catalogue.back")}
        </Link>
      </section>
    </>
  );
}
