import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Store · Vutto Parts" };

// Placeholder: the store screens are built in Prompt 12.
export default async function StorePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workshop } = await requireRole("/store", await searchParams);
  const t = await getT();
  return (
    <>
      <PageHeader title={t("pages.store")} subtitle={`${workshop.name} (${workshop.code})`} />
      <EmptyState message={t("common.comingSoon")} />
    </>
  );
}
