"use client";

import { useMemo } from "react";
import { inputClass } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import type { Database } from "@/lib/database.types";
import { useLang, useT } from "@/lib/i18n/client";

type Area = Database["public"]["Enums"]["finding_area"];
export type FindingTypeOption = { id: string; code: string; label_en: string; label_hi: string; area: Area };
/** Checked finding types, keyed by finding_type_id; qty "" means "use the default". */
export type PickedFindings = Record<string, { qty: string; notes: string }>;

const AREAS: Area[] = ["engine", "brakes", "drivetrain", "electrical", "body", "tyres_suspension"];

/** The p_findings array create_bike and update_draft_findings take (SPEC §5.2). */
export function findingsInput(picked: PickedFindings) {
  return Object.entries(picked).map(([finding_type_id, p]) => ({
    finding_type_id,
    qty: /^\d+$/.test(p.qty) ? Number(p.qty) : null,
    notes: p.notes.trim() || null,
  }));
}

/** Inspection findings grouped by finding_types.area, each with optional qty and notes. */
export function FindingsChecklist({
  findingTypes,
  picked,
  onChange,
}: {
  findingTypes: FindingTypeOption[];
  picked: PickedFindings;
  onChange: (next: PickedFindings) => void;
}) {
  const t = useT();
  const lang = useLang();
  const byArea = useMemo(() => {
    const groups = new Map<Area, FindingTypeOption[]>();
    for (const ft of findingTypes) groups.set(ft.area, [...(groups.get(ft.area) ?? []), ft]);
    return AREAS.filter((a) => groups.has(a)).map((a) => [a, groups.get(a)!] as const);
  }, [findingTypes]);

  const toggle = (id: string, on: boolean) => {
    const next = { ...picked };
    if (on) next[id] = { qty: "", notes: "" };
    else delete next[id];
    onChange(next);
  };
  const update = (id: string, patch: Partial<PickedFindings[string]>) =>
    onChange({ ...picked, [id]: { ...picked[id], ...patch } });

  return (
    <div className="flex flex-col gap-4">
      {byArea.map(([area, types]) => (
        <fieldset key={area} className="flex min-w-0 flex-col gap-1 rounded-xl border p-3">
          <legend className="px-1 font-medium">{t(`enums.finding_area.${area}`)}</legend>
          {types.map((ft) => {
            const p = picked[ft.id];
            const label = lang === "hi" ? ft.label_hi : ft.label_en;
            return (
              <div key={ft.id} className="flex flex-col gap-2 border-b py-1 last:border-b-0">
                <label className="flex min-h-12 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0"
                    data-testid={`finding-${ft.code}`}
                    checked={Boolean(p)}
                    onChange={(e) => toggle(ft.id, e.target.checked)}
                  />
                  <span className="min-w-0 break-words">{label}</span>
                </label>
                {p && (
                  <div className="grid grid-cols-[6rem_1fr] gap-2 pb-2 pl-8">
                    <Input
                      aria-label={t("bikes.findingQty", { finding: label })}
                      placeholder={t("bikes.qtyAuto")}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={3}
                      className={inputClass}
                      value={p.qty}
                      onChange={(e) => update(ft.id, { qty: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                    />
                    <Input
                      aria-label={t("bikes.findingNotes", { finding: label })}
                      placeholder={t("bikes.notes")}
                      maxLength={500}
                      className={inputClass}
                      value={p.notes}
                      onChange={(e) => update(ft.id, { notes: e.target.value })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
