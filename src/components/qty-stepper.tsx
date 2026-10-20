"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type Uom = Database["public"]["Enums"]["uom"];

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  uom: Uom;
  label?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Integer quantity with large ± buttons and the uom next to it (SPEC §13, §14). */
export function QtyStepper({ value, onChange, min = 1, max = 999, uom, label, name, disabled, className }: Props) {
  const t = useT();
  const id = useId();

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="size-14 shrink-0"
          aria-label={t("common.decrease")}
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - 1, min, max))}
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
          value={Number.isFinite(value) ? String(value) : ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
            onChange(digits === "" ? min : clamp(Number(digits), min, max));
          }}
          className="h-14 w-20 min-w-0 rounded-lg border border-input bg-background text-center text-lg tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          className="size-14 shrink-0"
          aria-label={t("common.increase")}
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + 1, min, max))}
        >
          <PlusIcon className="size-6" />
        </Button>
        <span className="text-base text-muted-foreground">{t(`enums.uom.${uom}`)}</span>
      </div>
    </div>
  );
}
