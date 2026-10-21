"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

export function PrintButton() {
  const t = useT();
  return (
    <Button type="button" className="h-12" onClick={() => window.print()}>
      {t("labels.print")}
    </Button>
  );
}
