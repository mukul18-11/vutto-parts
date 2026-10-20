import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatIST } from "@/lib/time";

/**
 * Detail pages call notFound() for ids that do not exist or belong to another workshop (SPEC §14).
 * A demo reset removes rows created since the last one, so old links also land here: say when.
 */
export default async function NotFound() {
  const t = await getT();
  const supabase = await createClient();
  const { data: meta } = await supabase.from("demo_meta").select("last_reset_at").maybeSingle();
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
