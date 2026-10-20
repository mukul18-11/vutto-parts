import { getT } from "@/lib/i18n/server";
import { formatISTTime } from "@/lib/time";

/**
 * Thin banner on every page for 1 hour after a demo reset (Prompt 13), so a reviewer whose page
 * suddenly shows other data knows why. by is null for the seed and the scheduled reseed.
 */
export async function ResetBanner({ at, by }: { at: string; by: string | null }) {
  const t = await getT();
  const time = formatISTTime(at);
  return (
    <p
      role="status"
      className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-900 print:hidden dark:bg-amber-950 dark:text-amber-100"
      data-testid="reset-banner"
    >
      {by ? t("resetBanner.by", { name: by, time }) : t("resetBanner.noUser", { time })}
    </p>
  );
}
