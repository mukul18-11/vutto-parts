import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AsOf } from "@/components/as-of";
import { RemountOnRestore } from "@/components/remount-on-restore";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { bikeLabel } from "../../card-finder";
import { IssueCard, type IssueBin, type IssueLineView } from "./issue-card";

export const metadata: Metadata = { title: "Issue parts · Vutto Parts" };

type Enums = Database["public"]["Enums"];

/**
 * Issue counter for one job card (SPEC §8.1, §9.2, §14): each reserved line with the bins that
 * hold its part (receiving first, "Not yet put away"), the fit badge, and the issue form.
 */
export default async function IssuePage({
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
  // the workshop is checked once the guard resolves), then the reads that depend on them.
  const [{ user, profile, workshop }, t, cardRes, linesRes] = await Promise.all([
    requireRole("/store/issue", sp),
    getT(),
    supabase
      .from("job_cards")
      .select(
        "id, workshop_id, code, status, bike:bikes(reg_no, status, mfg_year, variant_id, model:vehicle_models(make, model), variant:model_variants(name))",
      )
      .eq("id", cardId)
      .maybeSingle(),
    supabase
      .from("job_card_lines")
      .select("id, part_id, qty_required, qty_reserved, qty_issued, qty_returned, status, part:parts(sku, name, name_hi, uom, is_universal)")
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
  const label = bikeLabel(
    { make: bike.model?.make ?? null, model: bike.model?.model ?? null, variant_name: bike.variant?.name ?? null, mfg_year: bike.mfg_year },
    t,
  );

  const lines = linesRes.data ?? [];
  const partIds = [...new Set(lines.map((l) => l.part_id))];

  const [fits, balRes, binsRes] = await Promise.all([
    Promise.all(lines.map((l) => (l.qty_reserved > 0 ? supabase.rpc("fit_badge", { p_line_id: l.id }) : null))),
    partIds.length > 0
      ? supabase
          .from("stock_balances")
          .select("part_id, on_hand, bin:bins!inner(id, code, kind, is_active)")
          .eq("workshop_id", workshop.id)
          .in("part_id", partIds)
          .in("bin.kind", ["normal", "receiving"])
          .gt("on_hand", 0)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("bins")
      .select("id, code")
      .eq("workshop_id", workshop.id)
      .in("kind", ["normal", "receiving"])
      .eq("is_active", true)
      .order("code"),
  ]);
  for (const f of fits) if (f?.error) throw f.error;
  if (balRes.error) throw balRes.error;
  if (binsRes.error) throw binsRes.error;

  // Bins holding each part: receiving first ("Not yet put away"), then normal bins, most first.
  const binsByPart = new Map<string, IssueBin[]>();
  for (const b of balRes.data ?? []) {
    const bin = b.bin as { id: string; code: string; kind: Enums["bin_kind"] };
    const list = binsByPart.get(b.part_id) ?? [];
    list.push({ id: bin.id, code: bin.code, kind: bin.kind, on_hand: b.on_hand });
    binsByPart.set(b.part_id, list);
  }
  for (const list of binsByPart.values()) {
    list.sort((a, b) => Number(b.kind === "receiving") - Number(a.kind === "receiving") || b.on_hand - a.on_hand || a.code.localeCompare(b.code));
  }

  const views: IssueLineView[] = lines.map((l, i) => {
    const part = l.part as { sku: string; name: string; name_hi: string | null; uom: Enums["uom"]; is_universal: boolean };
    const net = l.qty_issued - l.qty_returned;
    return {
      id: l.id,
      part_id: l.part_id,
      sku: part.sku,
      name: part.name,
      name_hi: part.name_hi,
      uom: part.uom,
      is_universal: part.is_universal,
      qty_required: l.qty_required,
      qty_reserved: l.qty_reserved,
      net_issued: net,
      uncovered: l.qty_required - (l.qty_reserved + net),
      status: l.status as Enums["line_status"],
      fit: fits[i]?.data?.[0] ?? null,
      bins: binsByPart.get(l.part_id) ?? [],
    };
  });

  const why =
    card.status !== "confirmed"
      ? t("issue.whyCard", { status: t(`enums.job_card_status.${card.status}`) })
      : bike.status !== "at_workshop" && bike.status !== "in_repair"
        ? t("issue.whyBike", { status: t(`enums.bike_status.${bike.status}`) })
        : null;

  return (
    <>
      <header className="mb-4 flex flex-col gap-1">
        <h1 className="font-mono text-3xl font-bold tracking-wide" data-testid="issue-reg">
          {bike.reg_no}
        </h1>
        <p className="text-base">{label}</p>
        <p className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          <span className="font-mono">{card.code}</span>
          <span>{t(`enums.bike_status.${bike.status}`)}</span>
          <AsOf />
        </p>
      </header>
      {why && (
        <p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          {t("issue.notIssuable", { why })}
        </p>
      )}
      <RemountOnRestore>
        <IssueCard
          userId={user.id}
          workshopId={workshop.id}
          workshopCode={workshop.code}
          card={{ id: card.id, code: card.code, confirmed: card.status === "confirmed", variantId: bike.variant_id }}
          bikeLabel={label}
          issuable={why === null}
          lines={views}
          bins={binsRes.data ?? []}
          links={{
            done: link(`/store/issue/${card.id}/done?move={move}`),
            emergency: link("/store/emergency/{line}"),
          }}
        />
      </RemountOnRestore>
      <div className="mt-6">
        <Button asChild variant="outline" className="h-12 w-full text-base sm:w-auto">
          <Link href={link("/store/issue")}>{t("issue.backToList")}</Link>
        </Button>
      </div>
    </>
  );
}
