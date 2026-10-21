"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type Uom = Database["public"]["Enums"]["uom"];

type Props = {
  /** null shows a blank input (e.g. blind receiving starts empty); ± then starts from min. */
  value: number | null;
  onChange: (value: number) => void;
  /** Called when the input is cleared; without it, clearing sets min. */
  onClear?: () => void;
  min?: number;
  max?: number;
  uom: Uom;
  /** Required: every input has a label (SPEC §14). hideLabel keeps it for screen readers only. */
  label: string;
  hideLabel?: boolean;
  name?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Integer quantity with large ± buttons and the uom next to it (SPEC §13, §14). */
export function QtyStepper({
  value,
  onChange,
  onClear,
  min = 1,
  max = 999,
  uom,
  label,
  hideLabel,
  name,
  disabled,
  className,
  testId,
}: Props) {
  const t = useT();
  const id = useId();

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-sm font-medium"}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="size-14 shrink-0"
          aria-label={t("common.decrease")}
          disabled={disabled || value === null || value <= min}
          onClick={() => onChange(clamp((value ?? min) - 1, min, max))}
        >
          <MinusIcon className="size-6" />
        </Button>
        <input
          id={id}
          name={name}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          disabled={disabled}
          data-testid={testId}
          value={value !== null && Number.isFinite(value) ? String(value) : ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
            if (digits === "" && onClear) onClear();
            else onChange(digits === "" ? min : clamp(Number(digits), min, max));
          }}
          className="h-14 w-20 min-w-0 rounded-lg border border-input bg-background text-center text-lg tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          className="size-14 shrink-0"
          aria-label={t("common.increase")}
          disabled={disabled || (value !== null && value >= max)}
          onClick={() => onChange(value === null ? min : clamp(value + 1, min, max))}
        >
          <PlusIcon className="size-6" />
        </Button>
        <span className="text-base text-muted-foreground">{t(`enums.uom.${uom}`)}</span>
      </div>
    </div>
  );
}
