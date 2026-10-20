import type { Metadata } from "next";
import Link from "next/link";
import { AsOf } from "@/components/as-of";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Store · Vutto Parts" };

type Tile = { href: string; label: MessageKey; hint: MessageKey; count: number | null; testId: string };

/** Store keeper home (SPEC §14): one tile per counter job; every count comes from SQL. */
export default async function StorePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { profile, workshop } = await requireRole("/store", await searchParams);
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const res = await supabase.rpc("store_home_counts", { p_workshop_id: workshop.id }).single();
  if (res.error) throw res.error;
  const c = res.data;

  const tiles: Tile[] = [
    { href: "/store/receive", label: "store.toReceive", hint: "store.toReceiveHint", count: c.to_receive, testId: "store-receive" },
    { href: "/store/putaway", label: "store.toPutAway", hint: "store.toPutAwayHint", count: c.to_put_away, testId: "store-putaway" },
    { href: "/store/issue", label: "store.readyToIssue", hint: "store.readyToIssueHint", count: c.ready_to_issue, testId: "store-issue" },
    { href: "/store/return", label: "store.returns", hint: "store.returnsHint", count: null, testId: "store-return" },
    { href: "/store/emergency", label: "store.emergency", hint: "store.emergencyHint", count: c.emergency_waiting, testId: "store-emergency" },
    { href: "/stock", label: "store.stockLookup", hint: "store.stockLookupHint", count: null, testId: "store-stock" },
  ];

  return (
    <>
      <PageHeader
        title={t("pages.store")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
      />
      <nav aria-label={t("pages.store")}>
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {tiles.map((tile) => (
            <li key={tile.href} className="min-w-0">
              <Link
                href={link(tile.href)}
                data-testid={tile.testId}
                className="flex h-full min-h-28 flex-col justify-between gap-2 rounded-xl border p-3 hover:bg-muted"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-base font-semibold break-words">{t(tile.label)}</span>
                  {tile.count !== null && (
                    <span
                      className="text-2xl font-bold tabular-nums"
                      data-testid={`${tile.testId}-count`}
                    >
                      {tile.count}
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">{t(tile.hint)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
