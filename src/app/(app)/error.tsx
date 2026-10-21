"use client";

import { ErrorView } from "@/components/error-view";

/** SPEC §14 error state for every app page: retry plus a ref id that matches the server log. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
