"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEMO_ROLE_KEYS } from "@/lib/demo-accounts";
import { useT } from "@/lib/i18n/client";
import { signIn, type SignInState } from "./actions";

const initial: SignInState = { error: null };

export function LoginForm({ demoMode, next }: { demoMode: boolean; next?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <div className="flex flex-col gap-6">
      {state.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {t(state.error)}
        </p>
      )}

      {demoMode && (
        <form action={action} className="flex flex-col gap-3">
          {next && <input type="hidden" name="next" value={next} />}
          <h2 className="font-medium">{t("login.demoHeading")}</h2>
          <p className="text-sm text-muted-foreground">{t("login.demoNote")}</p>
          {DEMO_ROLE_KEYS.map((key) => (
            <Button
              key={key}
              type="submit"
              name="role"
              value={key}
              variant="outline"
              disabled={pending}
              className="h-14 w-full text-base"
            >
              {t("login.signInAs", { name: t(`login.demo.${key}`) })}
            </Button>
          ))}
        </form>
      )}

      <form action={action} className="flex flex-col gap-4">
        {next && <input type="hidden" name="next" value={next} />}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t("login.email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            defaultValue={state.email}
            className="h-12 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t("login.password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="h-12 text-base"
          />
        </div>
        <Button type="submit" disabled={pending} className="h-12 w-full text-base">
          {t("login.submit")}
        </Button>
      </form>
    </div>
  );
}
