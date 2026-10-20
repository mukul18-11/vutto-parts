"use client";

import { isMessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import type { RpcFormState } from "@/lib/use-rpc-form";

type DetailLine = {
  line_id?: string;
  sku?: string;
  qty_required?: number;
  qty_reserved?: number;
  net_issued?: number;
};

function linesOf(detail: unknown): DetailLine[] {
  const lines = (detail as { lines?: unknown } | null)?.lines;
  return Array.isArray(lines) ? (lines as DetailLine[]) : [];
}

/**
 * What an RPC refusal lists (OPEN_LINES, ISSUED_PARTS_OUTSTANDING lines; VALIDATION reason and
 * field errors), shown under the error message so the user sees exactly what blocks the action.
 */
export function ErrorDetail<T>({ state }: { state: RpcFormState<T> }) {
  const t = useT();
  if (state.kind !== "error") return null;
  const lines = linesOf(state.detail);
  if (state.code === "OPEN_LINES" || state.code === "ISSUED_PARTS_OUTSTANDING") {
    const review = (state.detail as { needs_review_reason?: string | null } | null)?.needs_review_reason;
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="error-detail">
        {lines.map((l, i) => (
          <li key={l.line_id ?? i}>
            <span className="font-mono">{l.sku}</span>
            {": "}
            {state.code === "OPEN_LINES"
              ? t("errorDetail.openLine", {
                  required: l.qty_required ?? 0,
                  reserved: l.qty_reserved ?? 0,
                  issued: l.net_issued ?? 0,
                })
              : t("errorDetail.issuedLine", { issued: l.net_issued ?? 0 })}
          </li>
        ))}
        {review && <li>{t("errorDetail.needsReview", { reason: review })}</li>}
      </ul>
    );
  }
  if (state.code === "VALIDATION") {
    const reason = (state.detail as { reason?: unknown } | null)?.reason;
    const reasonKey = typeof reason === "string" ? `validationReason.${reason}` : "";
    const fields = Object.entries(state.fieldErrors ?? {});
    if (!isMessageKey(reasonKey) && fields.length === 0) return null;
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm text-destructive" data-testid="error-detail">
        {isMessageKey(reasonKey) && <li>{t(reasonKey)}</li>}
        {fields.map(([field, key]) => {
          const label = `fields.${field}`;
          return (
            <li key={field}>
              {isMessageKey(label) ? t(label) : field}: {t(key, { min: 0, max: 999 })}
            </li>
          );
        })}
      </ul>
    );
  }
  return null;
}
