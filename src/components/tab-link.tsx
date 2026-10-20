import Link from "next/link";
import { cn } from "@/lib/utils";

/** A tab as a link with a URL parameter (server-rendered lists keep the tab in the URL). */
export function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap",
        active ? "bg-primary text-primary-foreground" : "border hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}
