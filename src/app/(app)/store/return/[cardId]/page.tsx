import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AsOf } from "@/components/as-of";
import { EmptyState } from "@/components/empty-state";
import { RemountOnRestore } from "@/components/remount-on-restore";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { bikeLabel } from "../../card-finder";
import { ReturnForm, type ReturnLine } from "./return-form";

export const metadata: Metadata = { title: "Return parts · Vutto Parts" };

type Enums = Database["public"]["Enums"];

/** Return from a job card (SPEC §8.2): line → reason → bin (not for damaged) → note → Return. */
export default async function ReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ cardId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ cardId }, sp] = await Promise.all([params, searchParams]);
  if (!z.guid().safeParse(cardId).success) notFound();
  const supabase = await createClient();

  // Two sequential round trips: the card and its lines run with the route guard (RLS scopes them;
  // the workshop is checked once the guard resolves), then bins and balances.
  const [{ user, profile, workshop }, t, cardRes, linesRes] = await Promise.all([
    requireRole("/store/return", sp),
    getT(),
    supabase
      .from("job_cards")
      .select("id, workshop_id, code, status, bike:bikes(reg_no, status, mfg_year, model:vehicle_models(make, model), variant:model_variants(name))")
      .eq("id", cardId)
      .maybeSingle(),
    supabase
      .from("job_card_lines")
      .select("id, part_id, qty_issued, qty_returned, part:parts(sku, name, name_hi, uom)")
      .eq("job_card_id", cardId)
      .is("cancelled_at", null)
      .order("created_at")
      .order("id"),
  ]);
  if (cardRes.error) throw cardRes.error;
  if (linesRes.error) throw linesRes.error;
  const link = (href: string) => withWs(href, profile.role, workshop.code);
  const card = cardRes.data;
  if (!card || !card.bike || card.workshop_id !== workshop.id) notFound();
  const bike = card.bike;
  const out = (linesRes.data ?? []).filter((l) => l.qty_issued - l.qty_returned > 0);

  // Suggested bin per part: the normal bin already holding the most of it (as for putaway).
  const partIds = [...new Set(out.map((l) => l.part_id))];
  const [binsRes, qrnRes, balRes] = await Promise.all([
    supabase.from("bins").select("id, code").eq("workshop_id", workshop.id).eq("kind", "normal").eq("is_active", true).order("code"),
    supabase.from("bins").select("code").eq("workshop_id", workshop.id).eq("kind", "quarantine").maybeSingle(),
    partIds.length > 0
      ? supabase
          .from("stock_balances")
          .select("part_id, on_hand, bin:bins!inner(id, code, kind)")
          .eq("workshop_id", workshop.id)
          .in("part_id", partIds)
          .eq("bin.kind", "normal")
          .gt("on_hand", 0)
          .order("on_hand", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [binsRes, qrnRes, balRes]) if (r.error) throw r.error;
  const suggested = new Map<string, { id: string; code: string }>();
  for (const b of balRes.data ?? []) {
    const bin = b.bin as { id: string; code: string };
    if (!suggested.has(b.part_id)) suggested.set(b.part_id, { id: bin.id, code: bin.code });
  }

  const lines: ReturnLine[] = out.map((l) => {
    const part = l.part as { sku: string; name: string; name_hi: string | null; uom: Enums["uom"] };
    return {
      id: l.id,
      sku: part.sku,
      name: part.name,
      name_hi: part.name_hi,
      uom: part.uom,
      net_issued: l.qty_issued - l.qty_returned,
      suggested: suggested.get(l.part_id) ?? null,
    };
  });
  const preselect = typeof sp.line === "string" && lines.some((l) => l.id === sp.line) ? sp.line : null;
  const label = bikeLabel(
    { make: bike.model?.make ?? null, model: bike.model?.model ?? null, variant_name: bike.variant?.name ?? null, mfg_year: bike.mfg_year },
    t,
  );

  return (
    <>
      <header className="mb-4 flex flex-col gap-1">
        <h1 className="font-mono text-3xl font-bold tracking-wide">{bike.reg_no}</h1>
        <p className="text-base">{label}</p>
        <p className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          <span className="font-mono">{card.code}</span>
          <span>{t(`enums.job_card_status.${card.status}`)}</span>
          <AsOf />
        </p>
      </header>
      {card.status !== "confirmed" ? (
        <EmptyState message={t("issue.notIssuable", { why: t("issue.whyCard", { status: t(`enums.job_card_status.${card.status}`) }) })} />
      ) : lines.length === 0 ? (
        <EmptyState
          message={t("returns.noReturnable")}
          action={
            <Button asChild variant="outline" className="h-12">
              <Link href={link("/store/return")}>{t("returns.title")}</Link>
            </Button>
          }
        />
      ) : (
        <RemountOnRestore>
          <ReturnForm
            userId={user.id}
            workshopCode={workshop.code}
            lines={lines}
            bins={binsRes.data ?? []}
            quarantineCode={qrnRes.data?.code ?? `${workshop.code}-QRN`}
            preselect={preselect}
            doneHref={link(`/store/return/${cardId}/done?move={move}&again={again}&others={others}`)}
          />
        </RemountOnRestore>
      )}
    </>
  );
}
