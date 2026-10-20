import { Badge } from "@/components/ui/badge";
import type { TFunction } from "@/lib/i18n";
import { formatDateOnly } from "@/lib/time";

/** ETA of an uncovered line (SPEC §7.6, v_line_eta). */
export type Eta = {
  eta_status: string | null;
  po_code: string | null;
  expected_on: string | null;
  is_overdue: boolean | null;
};

/** PO code + due date (red when overdue), "In draft PO-…" or "Not ordered". */
export function EtaBadge({
  part,
  t,
}: {
  part: Eta;
  t: TFunction;
}) {
  if (part.eta_status === "on_po" && part.expected_on) {
    return (
      <Badge
        data-testid="eta"
        className={
          "h-auto whitespace-normal " +
          (part.is_overdue
            ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100"
            : "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100")
        }
      >
        {part.po_code} · {formatDateOnly(part.expected_on)}
        {part.is_overdue && ` · ${t("eta.overdue")}`}
      </Badge>
    );
  }
  if (part.eta_status === "in_draft") {
    return (
      <Badge data-testid="eta" variant="secondary">
        {t("eta.inDraft", { code: part.po_code ?? "" })}
      </Badge>
    );
  }
  return (
    <Badge data-testid="eta" className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      {t("eta.notOrdered")}
    </Badge>
  );
}
