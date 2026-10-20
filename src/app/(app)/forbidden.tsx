import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getSessionContext } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { homeFor } from "@/lib/permissions";

// Rendered by forbidden() in requireRole: the page exists, but not for this role.
export default async function Forbidden() {
  const t = await getT();
  const ctx = await getSessionContext();
  const home = ctx.profile ? homeFor(ctx.profile.role) : "/";
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
      <h1 className="text-xl font-semibold">{t("access.forbiddenTitle")}</h1>
      <p className="text-muted-foreground">{t("access.forbiddenBody")}</p>
      <Button asChild className="h-12 w-full text-base">
        <Link href={home}>{t("access.goHome")}</Link>
      </Button>
    </div>
  );
}
