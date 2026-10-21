import { Suspense } from "react";
import { getT } from "@/lib/i18n/server";
import type { Profile, Workshop } from "@/lib/auth";
import { DEFAULT_WORKSHOP_CODE } from "@/lib/auth";
import { navFor } from "@/lib/permissions";
import { Brand } from "./brand";
import { LanguageToggle } from "./language-toggle";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";
import { WorkshopSwitcher } from "./workshop-switcher";

export async function AppHeader({ profile, workshops }: { profile: Profile; workshops: Workshop[] }) {
  const t = await getT();
  const isAdmin = profile.role === "admin";
  const own = workshops.find((w) => w.id === profile.workshop_id);
  const items = navFor(profile.role);

  return (
    <header className="border-b bg-background shadow-sm print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2">
        <div className="flex items-center justify-between gap-2">
          <Brand name={t("common.appName")} product={t("common.appProduct")} />
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <SignOutButton />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span data-testid="header-role" className="font-medium">
            {t(`enums.app_role.${profile.role}`)}
          </span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          {isAdmin ? (
            <Suspense fallback={null}>
              <WorkshopSwitcher
                workshops={workshops.map(({ code, name }) => ({ code, name }))}
                defaultCode={DEFAULT_WORKSHOP_CODE}
              />
            </Suspense>
          ) : (
            <span data-testid="header-workshop">{own ? `${own.name} (${own.code})` : ""}</span>
          )}
        </div>
        <Suspense fallback={null}>
          <NavLinks items={items} keepWorkshop={isAdmin} />
        </Suspense>
      </div>
    </header>
  );
}
