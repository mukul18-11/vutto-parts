"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/** A labelled form control with an optional error line. Inputs are >= 16 px (SPEC §14). */
export function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  className?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass = "h-12 w-full min-w-0 text-base md:text-base";

/** Native select styled like the inputs (works everywhere, no hover-only behaviour). */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-12 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-base disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
