import { clientEnv } from "@/env.client";
import { getT } from "@/lib/i18n/server";
import { formatDateOnly } from "@/lib/time";

type Props = { anchorDate: string | null; admin?: { schemaVersion: string | null } };

/** SPEC §14 footer on every page; admin also sees the schema version and commit SHA (SPEC §16). */
export async function AppFooter({ anchorDate, admin }: Props) {
  const t = await getT();
  return (
    <footer className="border-t px-4 py-3 text-center text-xs text-muted-foreground print:hidden">
      <p>{anchorDate ? t("footer.simulated", { date: formatDateOnly(anchorDate) }) : t("footer.notSeeded")}</p>
      {admin && (
        <p data-testid="footer-version" className="mt-1 font-mono">
          {t("footer.schema", { version: admin.schemaVersion ?? "?" })} ·{" "}
          {t("footer.commit", { sha: clientEnv.NEXT_PUBLIC_COMMIT_SHA.slice(0, 7) })}
        </p>
      )}
    </footer>
  );
}
