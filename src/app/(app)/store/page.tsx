import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";

export const metadata: Metadata = { title: "Store · Vutto Parts" };

// Receiving and putaway are built; the issue counter comes in Prompt 12.
export default async function StorePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { profile, workshop } = await requireRole("/store", await searchParams);
  const t = await getT();
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  return (
    <>
      <PageHeader title={t("pages.store")} subtitle={`${workshop.name} (${workshop.code})`} />
      <nav aria-label={t("pages.store")} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Button asChild className="h-14 text-base sm:flex-1">
          <Link href={link("/store/receive")} data-testid="store-receive">
            {t("receive.title")}
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-14 text-base sm:flex-1">
          <Link href={link("/store/putaway")} data-testid="store-putaway">
            {t("putaway.title")}
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-14 text-base sm:flex-1">
          <Link href={link("/stock")}>{t("pages.stock")}</Link>
        </Button>
      </nav>
      <EmptyState message={t("common.comingSoon")} />
    </>
  );
}
