import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getT } from "@/lib/i18n/server";

/** Detail pages call notFound() for ids that do not exist or belong to another workshop (SPEC §14). */
export default async function NotFound() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t("common.notFoundTitle")} />
      <EmptyState message={t("common.notFound")} />
    </>
  );
}
