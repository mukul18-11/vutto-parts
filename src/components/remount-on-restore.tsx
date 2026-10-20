"use client";

import { Fragment, useEffect, useState } from "react";

/**
 * Remounts its children when the page comes back from the back/forward cache (pageshow with
 * persisted = true), so a restored form starts clean with a new request_id instead of showing
 * a stale state that could be resubmitted (SPEC §11.1 client rule, §14).
 */
export function RemountOnRestore({ children }: { children: React.ReactNode }) {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setGeneration((g) => g + 1);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return <Fragment key={generation}>{children}</Fragment>;
}
