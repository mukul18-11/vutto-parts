import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole, type SearchParams } from "@/lib/auth";
import { Constants, type Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { decodeCursor, encodeCursor, keysetFilter } from "@/lib/keyset";
import { withWs } from "@/lib/links";
import { parseBikeSearch } from "@/lib/search-term";
import { createClient } from "@/lib/supabase/server";
import { formatIST } from "@/lib/time";

export const metadata: Metadata = { title: "Bikes · Vutto Parts" };

const PAGE = 25;
const UUID = /^[0-9a-f-]{36}$/i;
type Enums = Database["public"]["Enums"];
type BikeStatus = Enums["bike_status"];
// v_bike_list columns are typed nullable; only variant and card columns can be null.
type BikeRow = {
  id: string;
  reg_no: string;
  make: string;
  model: string;
  variant_name: string | null;
  mfg_year: number;
  status: BikeStatus;
  purchased_at: string;
  card_id: string | null;
  card_code: string | null;
  card_status: Enums["job_card_status"] | null;
};

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function BikesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { profile, workshop } = await requireRole("/bikes", sp);
  const t = await getT();
  const supabase = await createClient();
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  const statusParam = one(sp.status);
  const status = Constants.public.Enums.bike_status.find((s) => s === statusParam);
  const modelParam = one(sp.model);
  const model = modelParam && UUID.test(modelParam) ? modelParam : undefined;
  const qParam = one(sp.q) ?? "";
  const search = parseBikeSearch(qParam);
  const after = decodeCursor(one(sp.after));
  const before = after ? null : decodeCursor(one(sp.before));

  let query = supabase
    .from("v_bike_list")
    .select("id, reg_no, make, model, variant_name, mfg_year, status, purchased_at, card_id, card_code, card_status")
    .eq("workshop_id", workshop.id);
  if (status) query = query.eq("status", status);
  if (model) query = query.eq("model_id", model);
  if (search?.kind === "card") query = query.ilike("card_code", `%${search.code}%`);
  if (search?.kind === "reg") query = query.like("reg_no_norm", `%${search.suffix}`);
  if (after) query = query.or(keysetFilter("purchased_at", after, "after"));
  if (before) query = query.or(keysetFilter("purchased_at", before, "before"));
  const asc = Boolean(before);
  query = query.order("purchased_at", { ascending: asc }).order("id", { ascending: asc }).limit(PAGE + 1);

  const [bikesRes, modelsRes] = await Promise.all([
    query,
    supabase.from("vehicle_models").select("id, make, model").order("make").order("model"),
  ]);
  if (bikesRes.error) throw bikesRes.error;
  if (modelsRes.error) throw modelsRes.error;

  const data = bikesRes.data as BikeRow[];
  const more = data.length > PAGE;
  const rows = data.slice(0, PAGE);
  if (before) rows.reverse();
  const hasNext = before ? true : more;
  const hasPrev = before ? more : Boolean(after);

  const filterParams = new URLSearchParams();
  if (status) filterParams.set("status", status);
  if (model) filterParams.set("model", model);
  if (qParam) filterParams.set("q", qParam);
  const pageHref = (key: "after" | "before", row: (typeof rows)[number]) => {
    const p = new URLSearchParams(filterParams);
    p.set(key, encodeCursor({ ts: row.purchased_at, id: row.id }));
    return link(`/bikes?${p.toString()}`);
  };
  const filtered = Boolean(status || model || search);

  return (
    <>
      <PageHeader
        title={t("pages.bikes")}
        subtitle={`${workshop.name} (${workshop.code})`}
        actions={
          <Button asChild className="h-11">
            <Link href={link("/bikes/new")} data-testid="new-bike">
              {t("bikes.new")}
            </Link>
          </Button>
        }
      />

      <form method="get" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4" role="search">
        {profile.role === "admin" && <input type="hidden" name="ws" value={workshop.code} />}
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
          {t("bikes.search")}
          <Input name="q" defaultValue={qParam} placeholder={t("bikes.searchPlaceholder")} className="h-12 text-base md:text-base" />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
          {t("bikes.status")}
          <select name="status" defaultValue={status ?? ""} className="h-12 rounded-lg border border-input bg-background px-2 text-base">
            <option value="">{t("bikes.allStatuses")}</option>
            {Constants.public.Enums.bike_status.map((s: BikeStatus) => (
              <option key={s} value={s}>
                {t(`enums.bike_status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
          {t("bikes.model")}
          <select name="model" defaultValue={model ?? ""} className="h-12 rounded-lg border border-input bg-background px-2 text-base">
            <option value="">{t("bikes.allModels")}</option>
            {modelsRes.data.map((m) => (
              <option key={m.id} value={m.id}>
                {m.make} {m.model}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit" className="h-12 flex-1 text-base">
            {t("bikes.apply")}
          </Button>
          {filtered && (
            <Button asChild variant="outline" className="h-12 text-base">
              <Link href={link("/bikes")}>{t("bikes.clear")}</Link>
            </Button>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          message={filtered ? t("bikes.emptyFiltered") : t("bikes.empty")}
          action={
            <Button asChild variant="outline" className="h-11">
              <Link href={link("/bikes/new")}>{t("bikes.new")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("bikes.regNo")}</TableHead>
                <TableHead>{t("bikes.model")}</TableHead>
                <TableHead>{t("bikes.status")}</TableHead>
                <TableHead>{t("bikes.jobCard")}</TableHead>
                <TableHead>{t("bikes.purchasedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono font-medium">{b.reg_no}</TableCell>
                  <TableCell className="whitespace-normal">
                    {b.make} {b.model} · {b.variant_name ?? t("bikes.unknownVariant")} · {b.mfg_year}
                  </TableCell>
                  <TableCell>
                    <StatusBadge enum="bike_status" value={b.status} />
                  </TableCell>
                  <TableCell>
                    {b.card_id && b.card_status ? (
                      <Link href={link(`/job-cards/${b.card_id}`)} className="flex items-center gap-2 underline-offset-4 hover:underline">
                        <span className="font-mono text-sm">{b.card_code}</span>
                        <StatusBadge enum="job_card_status" value={b.card_status} />
                      </Link>
                    ) : (
                      "–"
                    )}
                  </TableCell>
                  <TableCell>{formatIST(b.purchased_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((b) => (
              <li key={b.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{b.reg_no}</span>
                  <StatusBadge enum="bike_status" value={b.status} />
                </div>
                <p className="text-sm break-words">
                  {b.make} {b.model} · {b.variant_name ?? t("bikes.unknownVariant")} · {b.mfg_year}
                </p>
                <p className="text-xs text-muted-foreground">{formatIST(b.purchased_at)}</p>
                {b.card_id && b.card_status && (
                  <Link href={link(`/job-cards/${b.card_id}`)} className="mt-2 flex min-h-11 items-center gap-2 underline">
                    <span className="font-mono text-sm">{b.card_code}</span>
                    <StatusBadge enum="job_card_status" value={b.card_status} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {(hasPrev || hasNext) && rows.length > 0 && (
        <nav className="mt-4 flex justify-between gap-2" aria-label={t("bikes.pages")}>
          {hasPrev ? (
            <Button asChild variant="outline" className="h-11">
              <Link href={pageHref("before", rows[0])}>{t("bikes.prev")}</Link>
            </Button>
          ) : (
            <span />
          )}
          {hasNext && (
            <Button asChild variant="outline" className="h-11">
              <Link href={pageHref("after", rows[rows.length - 1])}>{t("bikes.next")}</Link>
            </Button>
          )}
        </nav>
      )}
    </>
  );
}
