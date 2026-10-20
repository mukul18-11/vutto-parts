import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

/** Previous / next links for an offset-paginated server list (the page is in the URL). */
export async function Pager({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (page: number) => string }) {
  if (pages <= 1) return null;
  const t = await getT();
  return (
    <nav className="mt-3 flex items-center justify-between gap-2" aria-label={t("metrics.pageOf", { page, pages })}>
      {page > 1 ? (
        <Button asChild variant="outline" className="h-11">
          <Link href={hrefFor(page - 1)}>{t("metrics.prev")}</Link>
        </Button>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted-foreground">{t("metrics.pageOf", { page, pages })}</span>
      {page < pages ? (
        <Button asChild variant="outline" className="h-11">
          <Link href={hrefFor(page + 1)}>{t("metrics.next")}</Link>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}
