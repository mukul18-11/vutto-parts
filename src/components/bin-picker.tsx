"use client";

import { CheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { BinScanner } from "@/components/bin-scanner";
import { inputClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeBinInput } from "@/lib/bin-code";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type BinOption = { id: string; code: string };

type Props = {
  /** The bins this action may use (already filtered to the allowed kinds and workshop). */
  bins: BinOption[];
  workshopCode: string;
  value: string | null;
  onChange: (binId: string | null) => void;
  /** The bin where the part already sits (SPEC putaway rule), offered as a one-tap choice. */
  suggested?: BinOption | null;
  label?: string;
  disabled?: boolean;
  testId?: string;
};

const MAX_MATCHES = 8;

/**
 * Bin choice per SPEC §14: Scan (QR) next to a "Type bin code" typeahead that is always visible,
 * so the flow works without a camera. Typing the exact code selects the bin.
 */
export function BinPicker({ bins, workshopCode, value, onChange, suggested, label, disabled, testId }: Props) {
  const t = useT();
  const id = useId();
  const selected = bins.find((b) => b.id === value) ?? null;
  const [text, setText] = useState(selected?.code ?? "");
  const term = normalizeBinInput(text);
  const matches =
    term.length === 0 || term === selected?.code
      ? []
      : bins.filter((b) => b.code.includes(term)).slice(0, MAX_MATCHES);

  const pick = (bin: BinOption) => {
    setText(bin.code);
    onChange(bin.id);
  };

  const onType = (next: string) => {
    setText(next);
    const exact = bins.find((b) => b.code === normalizeBinInput(next));
    onChange(exact ? exact.id : null);
  };

  const onScan = (code: string) => {
    const bin = bins.find((b) => b.code === code);
    if (!bin) return false;
    pick(bin);
    return true;
  };

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <label htmlFor={id} className="text-sm font-medium">
        {label ?? t("binPicker.label")}
      </label>
      {suggested && suggested.id !== value && (
        <Button
          type="button"
          variant="secondary"
          className="h-12 justify-start text-base"
          disabled={disabled}
          onClick={() => pick(suggested)}
        >
          {t("binPicker.useSuggested", { code: suggested.code })}
        </Button>
      )}
      <BinScanner workshopCode={workshopCode} onCode={onScan} disabled={disabled} />
      <Input
        id={id}
        className={cn(inputClass, "font-mono uppercase")}
        placeholder={t("binPicker.typePlaceholder", { ws: workshopCode })}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={text}
        disabled={disabled}
        onChange={(e) => onType(e.target.value)}
        aria-describedby={`${id}-status`}
      />
      {matches.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t("binPicker.matches")}>
          {matches.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center rounded-lg border px-3 text-left font-mono text-base hover:bg-muted"
                disabled={disabled}
                onClick={() => pick(b)}
              >
                {b.code}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p id={`${id}-status`} className="text-sm" aria-live="polite">
        {selected ? (
          <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckIcon className="size-4" /> {t("binPicker.selected", { code: selected.code })}
          </span>
        ) : term.length > 0 && matches.length === 0 ? (
          <span className="text-destructive">{t("binPicker.noMatch")}</span>
        ) : (
          <span className="text-muted-foreground">{t("binPicker.typeHint")}</span>
        )}
      </p>
    </div>
  );
}
