import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Issue parts · Vutto Parts" };

// Placeholder for the per-card issue screen (Prompt 12). The receiving success screen already
// links here ("Issue now"), so the link names the card instead of a 404.
export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ cardId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ cardId }, sp] = await Promise.all([params, searchParams]);
  const { profile, workshop } = await requireRole("/store/issue", sp);
  if (!z.guid().safeParse(cardId).success) notFound();
  const t = await getT();
  const supabase = await createClient();
  const res = await supabase
    .from("job_cards")
    .select("id, code, bikes(reg_no)")
    .eq("id", cardId)
    .eq("workshop_id", workshop.id)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) notFound();
  const regNo = (res.data.bikes as { reg_no: string } | null)?.reg_no ?? "";

  return (
    <>
      <PageHeader title={t("issue.title", { code: res.data.code })} subtitle={regNo} />
      <EmptyState
        message={t("issue.comingSoon", { code: res.data.code, reg: regNo })}
        action={
          <Button asChild variant="outline" className="h-12">
            <Link href={withWs("/store", profile.role, workshop.code)}>{t("issue.backToStore")}</Link>
          </Button>
        }
      />
    </>
  );
}
