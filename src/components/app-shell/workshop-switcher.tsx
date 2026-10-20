"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/lib/i18n/client";

type Option = { code: string; name: string };

/** Admin only: the workshop lives in the URL (?ws=NCR|JPR, default NCR); pages read it. */
export function WorkshopSwitcher({ workshops, defaultCode }: { workshops: Option[]; defaultCode: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = searchParams.get("ws")?.toUpperCase();
  const value = workshops.some((w) => w.code === current) ? current : defaultCode;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("header.workshop")}</span>
      <select
        className="h-10 rounded-lg border border-input bg-background px-2 text-base"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("ws", e.target.value);
          startTransition(() => router.push(`${pathname}?${params.toString()}`));
        }}
      >
        {workshops.map((w) => (
          <option key={w.code} value={w.code}>
            {w.name} ({w.code})
          </option>
        ))}
      </select>
    </label>
  );
}
