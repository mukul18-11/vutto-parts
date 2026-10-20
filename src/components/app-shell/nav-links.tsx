"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { NavItem } from "@/lib/permissions";

/** Role-based navigation (from permissions.navFor). Admin links keep the ?ws= workshop. */
export function NavLinks({ items, keepWorkshop }: { items: NavItem[]; keepWorkshop: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const ws = useSearchParams().get("ws");
  const suffix = keepWorkshop && ws ? `?ws=${encodeURIComponent(ws)}` : "";

  return (
    <nav className="flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={`${item.href}${suffix}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap",
              active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}
