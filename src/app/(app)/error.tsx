"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

/** SPEC §14 error state for every app page: retry plus a ref id that matches the server log. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  const ref = error instanceof Error && "digest" in error ? String(error.digest) : null;
  return (
    <div className="mx-auto flex min-h-[50dvh] max-w-md flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-xl font-semibold">{t("errorPage.title")}</h1>
      <p className="text-muted-foreground">{ref ? t("errorPage.bodyRef", { ref }) : t("errorPage.body")}</p>
      <Button onClick={() => retry()} className="h-12 w-full text-base">
        {t("errorPage.retry")}
      </Button>
    </div>
  );
}
