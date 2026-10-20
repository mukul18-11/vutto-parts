"use client";

import { useT } from "@/lib/i18n/client";
import { useOnline } from "@/lib/use-rpc-form";

/** Shown while navigator.onLine is false; forms disable submit meanwhile (SPEC §14). */
export function OfflineBanner() {
  const online = useOnline();
  const t = useT();
  if (online) return null;
  return (
    <div role="status" className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      {t("rpcForm.offline")}
    </div>
  );
}
