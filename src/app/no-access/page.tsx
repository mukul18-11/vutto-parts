import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { getSessionContext } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "No access · Vutto Parts" };

// Signed in but no profile row. Outside the (app) group, so it never redirects back here (no loop).
export default async function NoAccessPage() {
  const ctx = await getSessionContext();
  if (!ctx.user) redirect("/login");
  if (ctx.profile) redirect("/");
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-xl font-semibold">{t("access.noAccessTitle")}</h1>
      <p className="text-muted-foreground">{t("access.noAccessBody")}</p>
      <p className="text-sm text-muted-foreground">{ctx.user.email}</p>
      <SignOutButton className="h-12 w-full text-base" />
    </main>
  );
}
