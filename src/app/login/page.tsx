import type { Metadata } from "next";
import { Brand } from "@/components/app-shell/brand";
import { Card,CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clientEnv } from "@/env.client";
import { getT } from "@/lib/i18n/server";
import type { SearchParams } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Vutto Parts" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { next } = await searchParams;
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <Brand name={t("common.appName")} product={t("common.appProduct")} className="[&_img]:h-8" />
          </CardTitle>
          <CardDescription>{t("login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm demoMode={clientEnv.NEXT_PUBLIC_DEMO_MODE} next={typeof next === "string" ? next : undefined} />
        </CardContent>
      </Card>
    </main>
  );
}
