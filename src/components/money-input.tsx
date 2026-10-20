"use client";

import { useId, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { rupeesToPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = {
  /** Called with integer paise, or null while the text is not a valid amount. */
  onChange: (paise: number | null, text: string) => void;
  defaultValue?: string;
  label?: string;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
};

/** Rupee amount typed as text and parsed with the shared parser (never floats, SPEC §13). */
export function MoneyInput({ onChange, defaultValue = "", label, name, disabled, invalid, className }: Props) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState(defaultValue);
  const showError = invalid || (text !== "" && rupeesToPaise(text) === null);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      )}
      <div className="flex h-12 items-center rounded-lg border border-input bg-background focus-within:ring-3 focus-within:ring-ring/50">
        <span className="pl-3 text-base text-muted-foreground">₹</span>
        <input
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={text}
          aria-invalid={showError || undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            setText(e.target.value);
            onChange(rupeesToPaise(e.target.value), e.target.value);
          }}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-base outline-none"
        />
      </div>
      <p id={`${id}-hint`} className={cn("text-xs", showError ? "text-destructive" : "text-muted-foreground")}>
        {showError ? t("validation.money") : t("common.inclGst")}
      </p>
    </div>
  );
}
