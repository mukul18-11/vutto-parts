"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setLang } from "@/lib/i18n/actions";
import { useLang, useT } from "@/lib/i18n/client";

/** Sets the 'lang' cookie and refreshes server components; client form state is kept. */
export function LanguageToggle() {
  const lang = useLang();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      className="h-12 px-3"
      disabled={pending}
      aria-label={t("header.switchLanguageLabel")}
      lang={lang === "en" ? "hi" : "en"}
      onClick={() =>
        startTransition(async () => {
          await setLang(lang === "en" ? "hi" : "en");
          router.refresh();
        })
      }
    >
      {t("header.switchLanguage")}
    </Button>
  );
}
