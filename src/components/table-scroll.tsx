"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";

/**
 * Bordered frame for a wide table. The table scrolls inside its own container (ui/table.tsx);
 * when it is wider than the screen, a right-edge fade and a "scroll sideways" hint say so, since
 * phone and macOS scrollbars stay hidden until touched.
 */
export function TableScroll({ children, testId }: { children: React.ReactNode; testId?: string }) {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = frame.current?.querySelector<HTMLElement>("[data-slot=table-container]") ?? frame.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      <div ref={frame} className="relative rounded-xl border" data-testid={testId}>
        {children}
        {overflows && (
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-linear-to-l from-background to-transparent" />
        )}
      </div>
      {overflows && (
        <p className="mt-1 text-right text-sm text-muted-foreground" data-testid="table-scroll-hint">
          {t("common.scrollHint")}
        </p>
      )}
    </div>
  );
}
