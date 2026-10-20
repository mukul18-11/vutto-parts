"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ErrorDetail } from "@/components/error-detail";
import { Field, inputClass, NativeSelect } from "@/components/forms/field";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/lib/database.types";
import type { MessageKey } from "@/lib/i18n";
import { useLang, useT } from "@/lib/i18n/client";
import { useRpcForm } from "@/lib/use-rpc-form";
import { createBike } from "./actions";

type Area = Database["public"]["Enums"]["finding_area"];
type Model = { id: string; make: string; model: string };
type Variant = { id: string; model_id: string; name: string; year_from: number; year_to: number | null };
type FindingType = { id: string; code: string; label_en: string; label_hi: string; area: Area };
type Picked = { qty: string; notes: string };

const AREAS: Area[] = ["engine", "brakes", "drivetrain", "electrical", "body", "tyres_suspension"];

type Props = {
  userId: string;
  workshopId: string;
  currentYear: number;
  models: Model[];
  variants: Variant[];
  findingTypes: FindingType[];
  /** Job card link with {id} for the new card's id (keeps ?ws= for admin). */
  cardHref: string;
};

/** New bike with its inspection findings (SPEC §5.2 create_bike). */
export function NewBikeForm({ userId, workshopId, currentYear, models, variants, findingTypes, cardHref }: Props) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const [regNo, setRegNo] = useState("");
  const [modelId, setModelId] = useState("");
  const [year, setYear] = useState("");
  const [variantId, setVariantId] = useState("");
  const [picked, setPicked] = useState<Record<string, Picked>>({});

  const { submit, pending, disabled, state } = useRpcForm(createBike, {
    userId,
    onSuccess: (data) => {
      const id = (data as { card_id?: string } | null)?.card_id;
      if (id) router.push(cardHref.replace("{id}", id));
    },
  });

  const yearNum = /^\d{4}$/.test(year) ? Number(year) : null;
  const variantOptions = useMemo(
    () =>
      variants.filter(
        (v) =>
          v.model_id === modelId &&
          (yearNum === null || (v.year_from <= yearNum && yearNum <= (v.year_to ?? currentYear))),
      ),
    [variants, modelId, yearNum, currentYear],
  );
  const variantValue = variantOptions.some((v) => v.id === variantId) ? variantId : "";

  const byArea = useMemo(() => {
    const groups = new Map<Area, FindingType[]>();
    for (const ft of findingTypes) groups.set(ft.area, [...(groups.get(ft.area) ?? []), ft]);
    return AREAS.filter((a) => groups.has(a)).map((a) => [a, groups.get(a)!] as const);
  }, [findingTypes]);

  const values = () => ({
    workshop_id: workshopId,
    reg_no: regNo,
    model_id: modelId,
    variant_id: variantValue || null,
    mfg_year: yearNum ?? Number.NaN,
    findings: Object.entries(picked).map(([finding_type_id, p]) => ({
      finding_type_id,
      qty: /^\d+$/.test(p.qty) ? Number(p.qty) : null,
      notes: p.notes.trim() || null,
    })),
  });
  const run = () => submit(values());

  const fieldError = (key: string): string | null => {
    if (state.kind !== "error") return null;
    const fe = state.fieldErrors?.[key];
    if (fe) return t(fe as MessageKey, { min: 1, max: 999 });
    const detail = state.detail as { field?: string; reason?: string; min?: number; max?: number } | null;
    if (key === "reg_no" && detail?.reason === "duplicate_reg_no") return t("bikes.duplicateReg");
    if (key === "mfg_year" && state.code === "MFG_YEAR_OUT_OF_RANGE")
      return t("bikes.yearRange", { min: detail?.min ?? 1995, max: detail?.max ?? currentYear });
    return null;
  };

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (on) next[id] = { qty: "", notes: "" };
      else delete next[id];
      return next;
    });
  const update = (id: string, patch: Partial<Picked>) =>
    setPicked((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  return (
    <form
      className="flex flex-col gap-6 pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t("bikes.regNo")} error={fieldError("reg_no")}>
          {(id) => (
            <Input
              id={id}
              name="reg_no"
              className={inputClass}
              autoComplete="off"
              autoCapitalize="characters"
              value={regNo}
              maxLength={20}
              onChange={(e) => setRegNo(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("bikes.model")} error={fieldError("model_id")}>
          {(id) => (
            <NativeSelect id={id} name="model_id" value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">{t("bikes.chooseModel")}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.make} {m.model}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t("bikes.year")} error={fieldError("mfg_year")}>
          {(id) => (
            <Input
              id={id}
              name="mfg_year"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              className={inputClass}
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          )}
        </Field>
        <Field
          label={t("bikes.variant")}
          hint={modelId && yearNum !== null && variantOptions.length === 0 ? t("bikes.noVariantForYear") : undefined}
        >
          {(id) => (
            <NativeSelect
              id={id}
              name="variant_id"
              value={variantValue}
              disabled={!modelId}
              onChange={(e) => setVariantId(e.target.value)}
            >
              <option value="">{t("bikes.unknownVariant")}</option>
              {variantOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.year_from}–{v.year_to ?? ""})
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </section>

      <section className="flex flex-col gap-4" aria-label={t("bikes.findings")}>
        <h2 className="text-lg font-semibold">
          {t("bikes.findings")} <span className="text-sm font-normal text-muted-foreground">({Object.keys(picked).length})</span>
        </h2>
        {byArea.map(([area, types]) => (
          <fieldset key={area} className="flex flex-col gap-1 rounded-xl border p-3">
            <legend className="px-1 font-medium">{t(`enums.finding_area.${area}`)}</legend>
            {types.map((ft) => {
              const p = picked[ft.id];
              const label = lang === "hi" ? ft.label_hi : ft.label_en;
              return (
                <div key={ft.id} className="flex flex-col gap-2 border-b py-1 last:border-b-0">
                  <label className="flex min-h-11 items-center gap-3">
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
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-background p-4">
        <RpcFormStatus state={state} onRetry={run} />
        <ErrorDetail state={state} />
        <Button type="submit" className="h-12 w-full text-base" disabled={disabled} data-testid="create-bike">
          {pending ? t("rpcForm.saving") : t("bikes.create")}
        </Button>
      </div>
    </form>
  );
}
