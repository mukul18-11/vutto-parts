import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { istToday } from "@/lib/time";
import { NewBikeForm } from "./new-bike-form";

export const metadata: Metadata = { title: "New bike · Vutto Parts" };

export default async function NewBikePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user, profile, workshop } = await requireRole("/bikes", await searchParams);
  const t = await getT();
  const supabase = await createClient();
  const [models, variants, findingTypes] = await Promise.all([
    supabase.from("vehicle_models").select("id, make, model").order("make").order("model"),
    supabase.from("model_variants").select("id, model_id, name, year_from, year_to").order("year_from").order("name"),
    supabase.from("finding_types").select("id, code, label_en, label_hi, area").eq("is_active", true).order("label_en"),
  ]);
  if (models.error) throw models.error;
  if (variants.error) throw variants.error;
  if (findingTypes.error) throw findingTypes.error;

  return (
    <>
      <PageHeader title={t("pages.newBike")} subtitle={`${workshop.name} (${workshop.code})`} />
      <NewBikeForm
        userId={user.id}
        workshopId={workshop.id}
        currentYear={Number(istToday().slice(0, 4))}
        models={models.data}
        variants={variants.data}
        findingTypes={findingTypes.data}
        cardHref={withWs("/job-cards/{id}", profile.role, workshop.code)}
      />
    </>
  );
}
