"use client";

import "./globals.css";
import { Button } from "@/components/ui/button";

// Replaces the root layout when it fails, so it renders its own <html> and <body>.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const ref = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <title>Something went wrong · Vutto Parts</title>
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground">
            The app could not load. Try again{ref ? `, or quote ref ${ref} if it keeps happening` : ""}.
          </p>
          <Button onClick={() => retry()} className="h-12 w-full">
            Try again
          </Button>
        </main>
      </body>
    </html>
  );
}
