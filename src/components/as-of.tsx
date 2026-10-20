import { getT } from "@/lib/i18n/server";
import { formatISTTime } from "@/lib/time";

/** "as of HH:MM IST" for stock screens (SPEC §14). Formatted on the server: no hydration mismatch. */
export async function AsOf({ at, className }: { at?: string | Date; className?: string }) {
  const t = await getT();
  const ts = at ?? new Date();
  return (
    <time dateTime={typeof ts === "string" ? ts : ts.toISOString()} className={className ?? "text-xs text-muted-foreground"}>
      {t("common.asOf", { time: formatISTTime(ts) })}
    </time>
  );
}
