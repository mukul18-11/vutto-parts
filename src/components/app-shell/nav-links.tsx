"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { NavItem } from "@/lib/permissions";

/**
 * Role-based navigation (from permissions.navFor). Admin links keep the ?ws= workshop. On narrow
 * screens it scrolls sideways (smoothly, snapping to links) and glides the active link into view.
 */
export function NavLinks({ items, keepWorkshop }: { items: NavItem[]; keepWorkshop: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const ws = useSearchParams().get("ws");
  const suffix = keepWorkshop && ws ? `?ws=${encodeURIComponent(ws)}` : "";
  const navRef = useRef<HTMLElement>(null);

  // Centre the active link inside the nav only (scrollIntoView would also scroll the page).
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({
      left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      className="relative -mx-1 flex snap-x snap-proximity scroll-px-1 gap-1.5 overflow-x-auto overscroll-x-contain px-1 pb-1 scrollbar-thin motion-safe:scroll-smooth"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={`${item.href}${suffix}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-12 shrink-0 snap-start items-center rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background hover:bg-muted",
            )}
          >
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}
