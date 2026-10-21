import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getDemoMeta } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { formatIST } from "@/lib/time";

/**
 * Detail pages call notFound() for ids that do not exist or belong to another workshop (SPEC §14).
 * A demo reset removes rows created since the last one, so old links also land here: say when.
 */
export default async function NotFound() {
  const t = await getT();
  // Usually already read by the layout in this request (React cache); optional here.
  const meta = await getDemoMeta().catch(() => null);
  return (
    <>
      <PageHeader title={t("common.notFoundTitle")} />
      <EmptyState message={t("common.notFound")} />
      {meta?.last_reset_at && (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="not-found-reset">
          {t("common.notFoundAfterReset", { time: formatIST(meta.last_reset_at) })}
        </p>
      )}
    </>
  );
}
