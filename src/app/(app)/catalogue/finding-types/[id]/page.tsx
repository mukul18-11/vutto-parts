import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { requireRole, type SearchParams } from "@/lib/auth";
import { ATTR_ENUM, type AttrKey } from "@/lib/catalogue";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { ActiveButton, FindingTypeDialog, MappingDialog } from "../../forms";

export const metadata: Metadata = { title: "Finding type · Vutto Parts" };

export default async function FindingTypePage({
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
  const [ftRes, mapRes] = await Promise.all([
    supabase.from("finding_types").select("id, code, label_en, label_hi, area, is_active").eq("id", id).maybeSingle(),
    supabase
      .from("finding_type_parts")
      .select("id, part_type, qty, attr_key, attr_value")
      .eq("finding_type_id", id)
      .order("attr_value", { nullsFirst: true }),
  ]);
  if (ftRes.error) throw ftRes.error;
  if (mapRes.error) throw mapRes.error;
  const ft = ftRes.data;
  if (!ft) notFound();
  const admin = profile.role === "admin";
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  return (
    <>
      <PageHeader
        title={ft.label_en}
        subtitle={
          <span>
            {ft.label_hi} · <span className="font-mono">{ft.code}</span> · {t(`enums.finding_area.${ft.area}`)}
          </span>
        }
        actions={
          admin && (
            <>
              <FindingTypeDialog userId={user.id} findingType={ft} />
              <ActiveButton userId={user.id} table="finding_types" id={ft.id} isActive={ft.is_active} />
            </>
          )
        }
      />
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("catalogue.mappings")}</h2>
          {admin && <MappingDialog userId={user.id} findingTypeId={ft.id} />}
        </div>
        <p className="text-sm text-muted-foreground">{t("catalogue.mappingRule")}</p>
        {mapRes.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("catalogue.noMappings")}</p>
        ) : (
          <ul className="rounded-xl border">
            {mapRes.data.map((m) => {
              const key = m.attr_key as AttrKey | null;
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b p-3 last:border-b-0">
                  <span className="min-w-0">
                    <span className="font-mono">{m.part_type}</span> × {m.qty}
                    <span className="block text-sm text-muted-foreground">
                      {key && m.attr_value
                        ? `${t(`catalogue.attr.${key}`)} = ${t(`enums.${ATTR_ENUM[key]}.${m.attr_value}` as MessageKey)}`
                        : t("catalogue.anyBike")}
                    </span>
                  </span>
                  {admin && <MappingDialog userId={user.id} findingTypeId={ft.id} mapping={m} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Link href={link("/catalogue?tab=findings")} className="mt-3 inline-block text-sm underline underline-offset-4">
        {t("catalogue.back")}
      </Link>
    </>
  );
}
