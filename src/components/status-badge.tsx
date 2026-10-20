"use client";

import { Badge } from "@/components/ui/badge";
import type { Database } from "@/lib/database.types";
import type { EnumName } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type Enums = Database["public"]["Enums"];
type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-foreground",
  info: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  success: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  danger: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
};

// Status-like enums get a tone; every other value is neutral.
const TONES: { [E in EnumName]?: Partial<Record<Enums[E], Tone>> } = {
  bike_status: { purchased: "info", at_workshop: "info", in_repair: "warning", ready: "success", cancelled: "danger" },
  job_card_status: { draft: "neutral", confirmed: "info", closed: "success", cancelled: "danger" },
  line_status: {
    needed: "danger",
    partially_reserved: "warning",
    reserved: "info",
    issued: "success",
    cancelled: "neutral",
  },
  po_status: {
    draft: "neutral",
    sent: "info",
    partially_received: "warning",
    received: "success",
    closed: "neutral",
    cancelled: "danger",
  },
  bin_kind: { normal: "neutral", receiving: "info", quarantine: "warning" },
  emergency_reason: { no_stock: "danger", supplier_late: "warning", wrong_part_received: "warning", other: "neutral" },
};

type Props<E extends EnumName> = { enum: E; value: Enums[E]; className?: string };

/** A translated label for any enum value, coloured for status enums. */
export function StatusBadge<E extends EnumName>({ enum: name, value, className }: Props<E>) {
  const t = useT();
  const tones = TONES[name] as Partial<Record<string, Tone>> | undefined;
  const tone = tones?.[value] ?? "neutral";
  // The key is checked by the enum generics above; the template literal widens it.
  const label = t(`enums.${name}.${value}` as Parameters<typeof t>[0]);
  return (
    <Badge data-value={value} className={cn(TONE_CLASS[tone], className)}>
      {label}
    </Badge>
  );
}
