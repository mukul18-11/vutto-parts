"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { classifyFailure } from "@/lib/health";
import { useT } from "@/lib/i18n/client";

/**
 * The body of every error boundary (SPEC §14: retry plus a ref id). Server errors reach the
 * browser only as a digest, so after an error it probes /api/health: when the database or the
 * network is down it says so ("waking up or unavailable") instead of showing a digest.
 */
export function ErrorView({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  const ref = error instanceof Error && "digest" in error ? String(error.digest) : null;
  const [kind, setKind] = useState<"checking" | "unavailable" | "error">("checking");

  useEffect(() => {
    let live = true;
    const settle = (status: number | null) => {
      if (live) setKind(classifyFailure({ online: navigator.onLine, status }));
    };
    fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(5000) }).then(
      (res) => settle(res.status),
      () => settle(null),
    );
    return () => {
      live = false;
    };
  }, [error]);

  const unavailable = kind === "unavailable";
  return (
    <div
      className="mx-auto flex min-h-[50dvh] max-w-md flex-col items-center justify-center gap-4 p-4 text-center"
      role="alert"
      data-testid="error-view"
      data-kind={kind}
    >
      <h1 className="text-xl font-semibold">{unavailable ? t("errorPage.unavailable") : t("errorPage.title")}</h1>
      <p className="min-h-6 text-muted-foreground">
        {kind === "checking"
          ? ""
          : unavailable
            ? t("errorPage.unavailableBody")
            : ref
              ? t("errorPage.bodyRef", { ref })
              : t("errorPage.body")}
      </p>
      <Button onClick={() => retry()} className="h-12 w-full text-base">
        {t("errorPage.retry")}
      </Button>
    </div>
  );
}
