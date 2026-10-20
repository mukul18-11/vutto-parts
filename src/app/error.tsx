"use client";

import { Button } from "@/components/ui/button";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  // Server errors reach the browser as a generic message plus a digest that matches the server log.
  const ref = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        Nothing was lost. Try again{ref ? `, or quote ref ${ref} if it keeps happening` : ""}.
      </p>
      <Button onClick={() => retry()} className="h-12 w-full">
        Try again
      </Button>
    </main>
  );
}
