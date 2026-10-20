"use client";

import { Badge } from "@/components/ui/badge";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";

export type FitBadgeRow = Database["public"]["Functions"]["fit_badge"]["Returns"][number];

/** SPEC §9.2 fit badge from fit_badge(line): red (flagged, with the last note), amber, green. */
export function FitBadge({ fit, isUniversal, bikeLabel }: { fit: FitBadgeRow | null; isUniversal: boolean; bikeLabel: string }) {
  const t = useT();
  if (!fit) return null;
  if (fit.badge === "red") {
    return (
      <Badge data-testid="fit" data-fit="red" className="h-auto bg-red-100 whitespace-normal text-red-900 dark:bg-red-950 dark:text-red-100">
        {t("fit.red")}
        {fit.last_flag_note ? ` · ${fit.last_flag_note}` : ""}
      </Badge>
    );
  }
  if (fit.badge === "amber") {
    return (
      <Badge data-testid="fit" data-fit="amber" className="h-auto bg-amber-100 whitespace-normal text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        {t("fit.amber", { bike: bikeLabel })}
      </Badge>
    );
  }
  return (
    <Badge data-testid="fit" data-fit="green" className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
      {isUniversal ? t("fit.universal") : t("fit.green", { n: fit.confirmed_count })}
    </Badge>
  );
}
