"use client";

import "./globals.css";
import { ErrorView } from "@/components/error-view";

// Replaces the root layout when it fails, so it renders its own <html> and <body>. Outside the
// I18nProvider, so the text is English.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <title>Something went wrong · Vutto Parts</title>
        <main className="flex min-h-dvh items-center justify-center">
          <ErrorView error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
