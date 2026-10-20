import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Blocked bikes · Vutto Parts" };

// Placeholder: the blocked board is built in Prompt 10.
export default async function BlockedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workshop } = await requireRole("/blocked", await searchParams);
  const t = await getT();
  return (
    <>
      <PageHeader title={t("pages.blocked")} subtitle={`${workshop.name} (${workshop.code})`} />
      <EmptyState message={t("common.comingSoon")} />
    </>
  );
}
