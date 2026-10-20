import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { formatINR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { ActiveButton, PartDialog, SupplierPriceDialog } from "../../forms";

export const metadata: Metadata = { title: "Part · Vutto Parts" };

export default async function PartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { user, profile, workshop } = await requireRole("/catalogue", sp);
  if (!z.guid().safeParse(id).success) notFound();
  const t = await getT();
  const supabase = await createClient();
  const [partRes, pricesRes, fitRes, suppliersRes] = await Promise.all([
    supabase
      .from("parts")
      .select(
        "id, sku, name, name_hi, aliases, oem_part_no, category, part_type, uom, standard_price_paise, preferred_supplier_id, is_universal, is_active, supplier:suppliers!parts_preferred_supplier_id_fkey(name, city)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("supplier_parts").select("supplier_id, supplier_code, price_paise, supplier:suppliers(name, city)").eq("part_id", id),
    supabase
      .from("part_fitments")
      .select("variant_id, qty_per_bike, source, confirmed_count, flagged_count, variant:model_variants(name, model:vehicle_models(make, model))")
      .eq("part_id", id),
    supabase.from("suppliers").select("id, name, city").eq("is_active", true).order("name"),
  ]);
  for (const r of [partRes, pricesRes, fitRes, suppliersRes]) if (r.error) throw r.error;
  const part = partRes.data;
  if (!part) notFound();
  const admin = profile.role === "admin";
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  const uom = t(`enums.uom.${part.uom}`);

  return (
    <>
      <PageHeader
        title={`${part.sku} · ${part.name}`}
        subtitle={part.name_hi ?? undefined}
        actions={
          admin && (
            <>
              <PartDialog userId={user.id} part={part} suppliers={suppliersRes.data ?? []} />
              <ActiveButton userId={user.id} table="parts" id={part.id} isActive={part.is_active} />
            </>
          )
        }
      />
      <dl className="mb-6 grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl border p-3 text-sm sm:grid-cols-2">
        <Item label={t("catalogue.category")} value={t(`enums.part_category.${part.category}`)} />
        <Item label={t("catalogue.partType")} value={<span className="font-mono">{part.part_type}</span>} />
        <Item label={t("catalogue.uom")} value={uom} />
        <Item label={`${t("catalogue.standardPrice")} (${t("common.inclGst")})`} value={formatINR(part.standard_price_paise)} />
        <Item label={t("catalogue.oemPartNo")} value={part.oem_part_no ?? "–"} />
        <Item
          label={t("catalogue.preferredSupplier")}
          value={part.supplier ? `${part.supplier.name} (${part.supplier.city})` : t("catalogue.none")}
        />
        <Item label={t("catalogue.aliases")} value={part.aliases.length ? part.aliases.join(", ") : "–"} />
        <Item
          label={t("catalogue.status")}
          value={
            <span className="flex flex-wrap gap-1">
              {part.is_universal && <Badge variant="secondary">{t("parts.universal")}</Badge>}
              <Badge variant={part.is_active ? "secondary" : "outline"}>
                {part.is_active ? t("catalogue.active") : t("catalogue.retired")}
              </Badge>
            </span>
          }
        />
      </dl>

      <section className="mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("catalogue.supplierPrices")}</h2>
          {admin && <SupplierPriceDialog userId={user.id} partId={part.id} suppliers={suppliersRes.data ?? []} />}
        </div>
        {(pricesRes.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("catalogue.noSupplierPrices")}</p>
        ) : (
          <ul className="rounded-xl border">
            {(pricesRes.data ?? []).map((p) => (
              <li key={p.supplier_id} className="flex flex-wrap items-center justify-between gap-2 border-b p-3 last:border-b-0">
                <span className="min-w-0 break-words">
                  {p.supplier?.name} ({p.supplier?.city})
                  {p.supplier_code && <span className="block font-mono text-xs text-muted-foreground">{p.supplier_code}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">
                    {formatINR(p.price_paise)} / {uom}
                  </span>
                  {admin && (
                    <SupplierPriceDialog userId={user.id} partId={part.id} suppliers={suppliersRes.data ?? []} row={p} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("catalogue.fitments")}</h2>
        {(fitRes.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{part.is_universal ? t("catalogue.universalNoFitments") : t("catalogue.noFitments")}</p>
        ) : (
          <ul className="rounded-xl border">
            {(fitRes.data ?? []).map((f) => (
              <li key={f.variant_id} className="flex flex-wrap items-center justify-between gap-2 border-b p-3 last:border-b-0">
                <Link href={link(`/catalogue/variants/${f.variant_id}`)} className="min-w-0 underline-offset-4 hover:underline">
                  {f.variant?.model?.make} {f.variant?.model?.model} {f.variant?.name}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {t("catalogue.perBike", { n: f.qty_per_bike, uom })} · {t(`enums.fitment_source.${f.source}`)} ·{" "}
                  {t("jobCard.counts", { confirmed: f.confirmed_count, flagged: f.flagged_count })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href={link("/catalogue?tab=parts")} className="mt-3 inline-block text-sm underline underline-offset-4">
        {t("catalogue.back")}
      </Link>
    </>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
