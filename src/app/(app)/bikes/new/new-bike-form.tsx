"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ErrorDetail } from "@/components/error-detail";
import { FindingsChecklist, findingsInput, type FindingTypeOption, type PickedFindings } from "@/components/findings-checklist";
import { Field, inputClass, NativeSelect } from "@/components/forms/field";
import { RpcFormStatus } from "@/components/rpc-form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useRpcForm } from "@/lib/use-rpc-form";
import { createBike } from "./actions";

type Model = { id: string; make: string; model: string };
type Variant = { id: string; model_id: string; name: string; year_from: number; year_to: number | null };

type Props = {
  userId: string;
  workshopId: string;
  currentYear: number;
  models: Model[];
  variants: Variant[];
  findingTypes: FindingTypeOption[];
  /** Job card link with {id} for the new card's id (keeps ?ws= for admin). */
  cardHref: string;
};

/** New bike with its inspection findings (SPEC §5.2 create_bike). */
export function NewBikeForm({ userId, workshopId, currentYear, models, variants, findingTypes, cardHref }: Props) {
  const t = useT();
  const router = useRouter();
  const [regNo, setRegNo] = useState("");
  const [modelId, setModelId] = useState("");
  const [year, setYear] = useState("");
  const [variantId, setVariantId] = useState("");
  const [picked, setPicked] = useState<PickedFindings>({});

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

  const values = () => ({
    workshop_id: workshopId,
    reg_no: regNo,
    model_id: modelId,
    variant_id: variantValue || null,
    mfg_year: yearNum ?? Number.NaN,
    findings: findingsInput(picked),
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
        <FindingsChecklist findingTypes={findingTypes} picked={picked} onChange={setPicked} />
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
