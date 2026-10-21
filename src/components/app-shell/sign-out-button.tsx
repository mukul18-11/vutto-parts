import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { signOut } from "./actions";

export async function SignOutButton({ className }: { className?: string }) {
  const t = await getT();
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" className={className ?? "h-12 px-3"}>
        <LogOutIcon aria-hidden />
        {t("common.signOut")}
      </Button>
    </form>
  );
}
