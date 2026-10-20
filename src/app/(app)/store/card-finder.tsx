import Link from "next/link";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PageContext, SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import type { TFunction } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { parseStoreSearch } from "@/lib/store";
import { createClient } from "@/lib/supabase/server";

type BikeStatus = Database["public"]["Enums"]["bike_status"];

/** "Hero Splendor Plus i3S · 2021" (variant unknown shown as such). */
export function bikeLabel(
  b: { make: string | null; model: string | null; variant_name: string | null; mfg_year: number | null },
  t: TFunction,
): string {
  const variant = b.variant_name ?? `(${t("store.variantUnknown")})`;
  return `${b.make ?? ""} ${b.model ?? ""} ${variant} · ${b.mfg_year ?? ""}`.replace(/\s+/g, " ").trim();
}

const LIMIT = 50;

/**
 * Card finder shared by the issue queue and the return finder (SPEC §14): confirmed cards of
 * bikes at the workshop or in a bay (v_store_cards), in_repair first, searchable by reg-no suffix
 * or job card code. mode "issue" lists cards holding reservations; "return" cards with parts out.
 */
export async function CardFinder({
  mode,
  ctx,
  sp,
}: {
  mode: "issue" | "return";
  ctx: PageContext;
  sp: SearchParams;
}) {
  const { profile, workshop } = ctx;
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 40) : "";
  const search = parseStoreSearch(q);

  let query = supabase
    .from("v_store_cards")
    .select("card_id, code, reg_no, bike_status, make, model, variant_name, mfg_year, reserved_lines, reserved_qty, returnable_lines")
    .eq("workshop_id", workshop.id);
  query = mode === "issue" ? query.gt("reserved_qty", 0) : query.gt("returnable_lines", 0);
  if (search?.kind === "card") query = query.like("code_norm", search.pattern);
  if (search?.kind === "reg") {
    query = search.alsoCode
      ? query.or(`reg_no_norm.like.*${search.suffix},code_norm.like.*${search.suffix}`)
      : query.like("reg_no_norm", `%${search.suffix}`);
  }
  const res = await query
    .order("bike_status", { ascending: false })
    .order("needed_by", { ascending: true, nullsFirst: false })
    .order("code")
    .limit(LIMIT);
  if (res.error) throw res.error;
  const rows = res.data ?? [];
  const base = mode === "issue" ? "/store/issue" : "/store/return";

  return (
    <>
      <PageHeader
        title={mode === "issue" ? t("issue.title") : t("returns.title")}
        subtitle={
          <span className="flex flex-wrap gap-x-2">
            <span>{`${workshop.name} (${workshop.code})`}</span>
            <AsOf />
          </span>
        }
      />
      <form method="get" role="search" className="mb-4 flex min-w-0 items-end gap-2">
        {profile.role === "admin" && <input type="hidden" name="ws" value={workshop.code} />}
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
          {t("store.search")}
          <Input
            name="q"
            defaultValue={q}
            placeholder={t("store.searchPlaceholder")}
            autoComplete="off"
            autoCapitalize="characters"
            className="h-12 text-base md:text-base"
            data-testid="card-search"
          />
        </label>
        <Button type="submit" className="h-12 text-base">
          {t("store.find")}
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          message={q ? t("store.noMatch", { q }) : mode === "issue" ? t("issue.listEmpty") : t("returns.listEmpty")}
          action={
            <Button asChild variant="outline" className="h-12">
              <Link href={link(q ? base : "/store")}>{q ? t("store.clear") : t("store.backToStore")}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="card-list">
          {rows.map((r) => (
            <li key={r.card_id}>
              <Link
                href={link(`${base}/${r.card_id}`)}
                className="flex flex-col gap-1 rounded-xl border p-3 hover:bg-muted"
                data-testid={`card-${r.code}`}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-lg font-semibold">{r.reg_no}</span>
                  <StatusBadge enum="bike_status" value={r.bike_status as BikeStatus} />
                </span>
                <span className="text-sm">{bikeLabel(r, t)}</span>
                <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                  <span className="font-mono">{r.code}</span>
                  {mode === "issue" ? (
                    <span>{t("issue.reservedLines", { n: r.reserved_lines ?? 0 })}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
