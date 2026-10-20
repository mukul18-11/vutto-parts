import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import type { TFunction } from "@/lib/i18n";
import { getLang, getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { formatINR } from "@/lib/money";
import { safeTerm } from "@/lib/search-term";
import { createClient } from "@/lib/supabase/server";
import { formatIST } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActiveButton, BinDialog, FindingTypeDialog, ModelDialog, PartDialog, SupplierDialog } from "./forms";

export const metadata: Metadata = { title: "Catalogue · Vutto Parts" };

const TABS = ["models", "parts", "findings", "suppliers", "bins"] as const;
type Tab = (typeof TABS)[number];
type Area = Database["public"]["Enums"]["finding_area"];
const PAGE = 25;

type Ctx = {
  t: TFunction;
  sp: SearchParams;
  userId: string;
  admin: boolean;
  link: (href: string) => string;
  workshop: { id: string; code: string; name: string };
};

export default async function CataloguePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { user, profile, workshop } = await requireRole("/catalogue", sp);
  const t = await getT();
  const tab: Tab = TABS.find((x) => x === sp.tab) ?? "models";
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  const ctx: Ctx = { t, sp, userId: user.id, admin: profile.role === "admin", link, workshop };

  return (
    <>
      <PageHeader title={t("pages.catalogue")} subtitle={ctx.admin ? t("catalogue.adminEdits") : t("catalogue.readOnly")} />
      <nav className="mb-4 flex flex-wrap gap-1" aria-label={t("catalogue.tabs")}>
        {TABS.map((x) => (
          <Link
            key={x}
            href={link(`/catalogue?tab=${x}`)}
            aria-current={x === tab ? "page" : undefined}
            className={cn(
              "flex h-10 items-center rounded-lg px-3 text-sm font-medium",
              x === tab ? "bg-primary text-primary-foreground" : "border hover:bg-muted",
            )}
          >
            {t(`catalogue.tab.${x}`)}
          </Link>
        ))}
      </nav>
      {tab === "models" && <Models ctx={ctx} />}
      {tab === "parts" && <Parts ctx={ctx} />}
      {tab === "findings" && <Findings ctx={ctx} />}
      {tab === "suppliers" && <Suppliers ctx={ctx} />}
      {tab === "bins" && <Bins ctx={ctx} />}
    </>
  );
}

function Row({ children, muted, testId }: { children: React.ReactNode; muted?: boolean; testId?: string }) {
  return (
    <li data-testid={testId} className={cn("flex flex-wrap items-center justify-between gap-2 border-b p-3 last:border-b-0", muted && "opacity-60")}>
      {children}
    </li>
  );
}

async function Models({ ctx }: { ctx: Ctx }) {
  const { t, admin, link, userId } = ctx;
  const { data, error } = await (await createClient())
    .from("vehicle_models")
    .select("id, make, model, segment")
    .order("make")
    .order("model");
  if (error) throw error;
  return (
    <section className="flex flex-col gap-3">
      {admin && (
        <div>
          <ModelDialog userId={userId} />
        </div>
      )}
      {data.length === 0 ? (
        <EmptyState message={admin ? t("catalogue.emptyModelsAdmin") : t("catalogue.empty")} />
      ) : (
        <ul className="rounded-xl border">
          {data.map((m) => (
            <Row key={m.id}>
              <Link href={link(`/catalogue/models/${m.id}`)} className="min-w-0 font-medium underline-offset-4 hover:underline">
                {m.make} {m.model}
              </Link>
              <Badge variant="secondary">{t(`enums.vehicle_segment.${m.segment}`)}</Badge>
            </Row>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Parts({ ctx }: { ctx: Ctx }) {
  const { t, admin, link, userId, sp } = ctx;
  const supabase = await createClient();
  const q = safeTerm(typeof sp.q === "string" ? sp.q : "");
  const after = typeof sp.after === "string" ? safeTerm(sp.after) : "";
  let query = supabase
    .from("parts")
    .select("id, sku, name, name_hi, category, uom, standard_price_paise, is_active, is_universal")
    .order("sku")
    .limit(PAGE + 1);
  if (q) {
    const norm = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const ors = [`sku.ilike.*${q}*`, `name.ilike.*${q}*`, `name_hi.ilike.*${q}*`];
    if (norm) ors.push(`oem_part_no_norm.like.${norm}*`);
    query = query.or(ors.join(","));
  }
  if (after) query = query.gt("sku", after);
  const [partsRes, suppliersRes] = await Promise.all([
    query,
    supabase.from("suppliers").select("id, name, city").eq("is_active", true).order("name"),
  ]);
  if (partsRes.error) throw partsRes.error;
  if (suppliersRes.error) throw suppliersRes.error;
  const rows = partsRes.data.slice(0, PAGE);
  const more = partsRes.data.length > PAGE;
  const next = new URLSearchParams({ tab: "parts", ...(q ? { q } : {}), after: rows.at(-1)?.sku ?? "" });

  return (
    <section className="flex flex-col gap-3">
      <form method="get" role="search" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="parts" />
        {admin && <input type="hidden" name="ws" value={ctx.workshop.code} />}
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
          {t("parts.search")}
          <Input name="q" defaultValue={q} className="h-12 text-base md:text-base" />
        </label>
        <Button type="submit" className="h-12 text-base">
          {t("bikes.apply")}
        </Button>
        {admin && <PartDialog userId={userId} suppliers={suppliersRes.data} />}
      </form>
      {rows.length === 0 ? (
        <EmptyState message={q ? t("catalogue.noPartsMatch") : t("catalogue.empty")} />
      ) : (
        <ul className="rounded-xl border">
          {rows.map((p) => (
            <Row key={p.id} muted={!p.is_active} testId={`part-${p.sku}`}>
              <Link href={link(`/catalogue/parts/${p.id}`)} className="min-w-0 underline-offset-4 hover:underline">
                <span className="font-mono text-sm">{p.sku}</span> <span className="break-words">{p.name}</span>
                {p.name_hi && <span className="block text-sm text-muted-foreground">{p.name_hi}</span>}
              </Link>
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{t(`enums.part_category.${p.category}`)}</Badge>
                {p.is_universal && <Badge variant="secondary">{t("parts.universal")}</Badge>}
                {!p.is_active && <Badge variant="outline">{t("catalogue.retired")}</Badge>}
                <span className="tabular-nums">
                  {formatINR(p.standard_price_paise)} / {t(`enums.uom.${p.uom}`)}
                </span>
              </span>
            </Row>
          ))}
        </ul>
      )}
      {more && (
        <Button asChild variant="outline" className="h-11 self-end">
          <Link href={link(`/catalogue?${next.toString()}`)}>{t("bikes.next")}</Link>
        </Button>
      )}
    </section>
  );
}

const AREAS: Area[] = ["engine", "brakes", "drivetrain", "electrical", "body", "tyres_suspension"];

async function Findings({ ctx }: { ctx: Ctx }) {
  const { t, admin, link, userId } = ctx;
  const lang = await getLang();
  const { data, error } = await (await createClient())
    .from("finding_types")
    .select("id, code, label_en, label_hi, area, is_active")
    .order("code");
  if (error) throw error;
  return (
    <section className="flex flex-col gap-3">
      {admin && (
        <div>
          <FindingTypeDialog userId={userId} />
        </div>
      )}
      {data.length === 0 && <EmptyState message={t("catalogue.empty")} />}
      {AREAS.map((area) => {
        const types = data.filter((f) => f.area === area);
        if (types.length === 0) return null;
        return (
          <div key={area} className="flex flex-col gap-1">
            <h2 className="font-semibold">{t(`enums.finding_area.${area}`)}</h2>
            <ul className="rounded-xl border">
              {types.map((f) => (
                <Row key={f.id} muted={!f.is_active}>
                  <Link href={link(`/catalogue/finding-types/${f.id}`)} className="min-w-0 underline-offset-4 hover:underline">
                    {lang === "hi" ? f.label_hi : f.label_en}
                    <span className="block font-mono text-xs text-muted-foreground">{f.code}</span>
                  </Link>
                  {!f.is_active && <Badge variant="outline">{t("catalogue.retired")}</Badge>}
                </Row>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

async function Suppliers({ ctx }: { ctx: Ctx }) {
  const { t, admin, userId } = ctx;
  const { data, error } = await (await createClient())
    .from("suppliers")
    .select("id, name, city, phone, kind, lead_time_days, is_active")
    .order("name");
  if (error) throw error;
  return (
    <section className="flex flex-col gap-3">
      {admin && (
        <div>
          <SupplierDialog userId={userId} />
        </div>
      )}
      {data.length === 0 ? (
        <EmptyState message={t("catalogue.empty")} />
      ) : (
        <ul className="rounded-xl border">
          {data.map((s) => (
            <Row key={s.id} muted={!s.is_active}>
              <span className="min-w-0">
                <span className="font-medium break-words">{s.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {s.city} · {s.phone} · {t(`enums.supplier_kind.${s.kind}`)} · {t("catalogue.leadDays", { n: s.lead_time_days })}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {!s.is_active && <Badge variant="outline">{t("catalogue.retired")}</Badge>}
                {admin && <SupplierDialog userId={userId} supplier={s} />}
                {admin && <ActiveButton userId={userId} table="suppliers" id={s.id} isActive={s.is_active} />}
              </span>
            </Row>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Bins({ ctx }: { ctx: Ctx }) {
  const { t, admin, link, userId, workshop } = ctx;
  const { data, error } = await (await createClient())
    .from("bins")
    .select("id, code, kind, is_active, count_requested_at")
    .eq("workshop_id", workshop.id)
    .order("code");
  if (error) throw error;
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {workshop.name} ({workshop.code}) · {t("catalogue.binsImmutable")}
      </p>
      <div className="flex flex-wrap gap-2">
        {admin && <BinDialog userId={userId} workshopId={workshop.id} workshopCode={workshop.code} />}
        <Button asChild variant="outline" className="h-11">
          <Link href={link("/bins/labels")}>{t("labels.printAll")}</Link>
        </Button>
      </div>
      {data.length === 0 ? (
        <EmptyState message={admin ? t("catalogue.emptyBinsAdmin") : t("catalogue.empty")} />
      ) : (
        <ul className="rounded-xl border">
          {data.map((b) => (
            <Row key={b.id} muted={!b.is_active}>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{b.code}</span>
                <StatusBadge enum="bin_kind" value={b.kind} />
                {!b.is_active && <Badge variant="outline">{t("catalogue.retired")}</Badge>}
                {b.count_requested_at && (
                  <span className="text-xs text-muted-foreground">
                    {t("catalogue.countRequested", { at: formatIST(b.count_requested_at) })}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Button asChild variant="ghost" className="h-11">
                  <Link href={link(`/bins/labels?bin=${b.id}`)}>{t("labels.label")}</Link>
                </Button>
                {admin && b.kind === "normal" && <ActiveButton userId={userId} table="bins" id={b.id} isActive={b.is_active} />}
              </span>
            </Row>
          ))}
        </ul>
      )}
    </section>
  );
}
