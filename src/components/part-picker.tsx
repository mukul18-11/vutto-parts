"use client";

import { useEffect, useRef, useState } from "react";
import { Field, inputClass } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type PartHit = Database["public"]["Functions"]["search_parts"]["Returns"][number];

type Props = {
  workshopId: string;
  variantId?: string | null;
  /** Filter to this part_type; "Show all" drops the filter (SPEC §9.1 step 7). */
  partType?: string | null;
  onPick: (part: PartHit) => void;
  selectedId?: string | null;
  disabled?: boolean;
  testId?: string;
};

const DEBOUNCE_MS = 250;

/**
 * Part search through search_parts (SPEC §14): min 2 chars, 250 ms debounce, stale responses
 * ignored; shows available stock in the workshop and a "Fits" mark when a variant is given.
 */
export function PartPicker({ workshopId, variantId, partType, onPick, selectedId, disabled, testId }: Props) {
  const t = useT();
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(!partType);
  // The last response, keyed by the query it answers; anything else is still loading or stale.
  const [result, setResult] = useState<{ key: string; hits: PartHit[]; failed: boolean } | null>(null);
  const seq = useRef(0);
  const filterType = showAll ? null : (partType ?? null);
  const term = q.trim();
  const key = `${term}|${filterType ?? ""}`;
  const active = term.length >= 2;
  const current = active && result?.key === key ? result : null;
  const status = !active ? "idle" : !current ? "loading" : current.failed ? "error" : "done";
  const hits = current?.hits ?? [];

  useEffect(() => {
    if (term.length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const { data, error } = await createClient().rpc("search_parts", {
        p_q: term,
        p_workshop_id: workshopId,
        ...(variantId ? { p_variant_id: variantId } : {}),
        ...(filterType ? { p_part_type: filterType } : {}),
      });
      if (mine !== seq.current) return;
      setResult({ key: `${term}|${filterType ?? ""}`, hits: error ? [] : (data ?? []), failed: Boolean(error) });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, filterType, workshopId, variantId]);

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <Field
        label={t("parts.search")}
        hint={partType && !showAll ? t("parts.filteredTo", { type: partType }) : t("parts.searchHint")}
      >
        {(id) => (
          <Input
            id={id}
            type="search"
            autoComplete="off"
            className={inputClass}
            value={q}
            disabled={disabled}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
      </Field>
      {partType && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          {t("parts.showAll")}
        </label>
      )}
      {status === "loading" && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {status === "error" && <p className="text-sm text-destructive">{t("parts.searchFailed")}</p>}
      {status === "done" && hits.length === 0 && <p className="text-sm text-muted-foreground">{t("parts.noResults")}</p>}
      {hits.length > 0 && (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {hits.map((p) => (
            <li key={p.part_id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(p)}
                aria-pressed={selectedId === p.part_id}
                data-testid={`part-hit-${p.sku}`}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-lg border p-2 text-left",
                  selectedId === p.part_id ? "border-primary bg-primary/5" : "hover:bg-muted",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{p.sku}</span>
                  {p.fits && <Badge className="bg-emerald-100 text-emerald-900">{t("parts.fits")}</Badge>}
                  {p.is_universal && <Badge variant="secondary">{t("parts.universal")}</Badge>}
                </span>
                <span className="break-words">{p.name}</span>
                {p.name_hi && <span className="text-sm text-muted-foreground">{p.name_hi}</span>}
                <span className="text-xs text-muted-foreground">
                  {t("parts.available", { qty: p.available, uom: t(`enums.uom.${p.uom}`) })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
