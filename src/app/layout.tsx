import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/lib/i18n/client";
import { getLang } from "@/lib/i18n/server";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// Every page renders per request; user data is never cached (CLAUDE.md rule 7).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vutto Parts",
  description: "Spare parts inventory for Vutto workshops",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // <html lang> follows the 'lang' cookie (SPEC §14).
  const lang = await getLang();
  return (
    <html lang={lang} className={cn("font-sans", geist.variable)}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <I18nProvider lang={lang}>{children}</I18nProvider>
        <Toaster />
      </body>
    </html>
  );
}
