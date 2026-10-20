import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requireRole, type SearchParams } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { isMessageKey } from "@/lib/i18n";
import { getLang, getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { formatIST } from "@/lib/time";
import { CardActions, NeededBy, NeedsReviewBanner } from "./card-actions";
import { EditFindings, SetVariant } from "./draft-edits";
import { Findings } from "./findings";
import { Lines } from "./lines";
import type { CardView, FindingView, Holder, LineView } from "./types";

export const metadata: Metadata = { title: "Job card · Vutto Parts" };

type Enums = Database["public"]["Enums"];
type FindingRow = {
  id: string;
  finding_type_id: string;
  code: string;
  label_en: string;
  label_hi: string;
  area: Enums["finding_area"];
  qty: number | null;
  notes: string | null;
  job_card_line_id: string | null;
  no_part_reason: string | null;
  applicable_part_type: string | null;
};

const LINE_ORDER: Record<string, number> = { needed: 0, partially_reserved: 1, reserved: 2, issued: 3, cancelled: 4 };

export default async function JobCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { user, profile, workshops } = await requireRole("/job-cards", sp);
  if (!z.guid().safeParse(id).success) notFound();
  const t = await getT();
  const lang = await getLang();
  const supabase = await createClient();

  const cardRes = await supabase
    .from("job_cards")
    .select(
      "id, workshop_id, code, status, needed_by, needs_review_reason, bike_id, bike:bikes(id, reg_no, status, mfg_year, model_id, variant_id, model:vehicle_models(make, model), variant:model_variants(name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (cardRes.error) throw cardRes.error;
  const row = cardRes.data;
  if (!row || !row.bike) notFound();
  const bike = row.bike;
  const workshopCode = workshops.find((w) => w.id === row.workshop_id)?.code ?? "";
  const link = (href: string) => withWs(href, profile.role, workshopCode);
  const isDraft = row.status === "draft";
  const isConfirmed = row.status === "confirmed";

  const [linesRes, findingsRes, etaRes, historyRes, openRes] = await Promise.all([
    supabase
      .from("job_card_lines")
      .select(
        "id, part_id, qty_required, qty_reserved, qty_issued, qty_returned, status, source, cancelled_at, part:parts(sku, name, name_hi, uom, is_universal)",
      )
      .eq("job_card_id", id)
      .order("created_at")
      .order("id"),
    supabase
      .from("v_job_card_findings")
      .select("id, finding_type_id, code, label_en, label_hi, area, qty, notes, job_card_line_id, no_part_reason, applicable_part_type")
      .eq("job_card_id", id)
      .order("created_at")
      .order("id"),
    supabase.from("v_line_eta").select("line_id, eta_status, po_code, expected_on, is_overdue").eq("job_card_id", id),
    supabase.rpc("job_card_history", { p_card_id: id }),
    row.status === "cancelled"
      ? supabase.from("job_cards").select("id").eq("bike_id", row.bike_id).in("status", ["draft", "confirmed"]).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const res of [linesRes, findingsRes, etaRes, historyRes, openRes]) if (res.error) throw res.error;
  const lines = linesRes.data ?? [];
  const live = lines.filter((l) => !l.cancelled_at);
  // View columns are typed nullable; these are never null for a row of the view.
  const findings = (findingsRes.data ?? []) as FindingRow[];
  const unresolved = findings.filter((f) => !f.job_card_line_id && !f.no_part_reason);

  // Per-line and per-finding reads (SPEC §9): fit badge, "1 of N" candidates, finding candidates,
  // and on confirmed cards the other lines holding a reservation of the same part.
  const uncoveredParts = isConfirmed
    ? [...new Set(live.filter((l) => l.qty_required > l.qty_reserved + l.qty_issued - l.qty_returned).map((l) => l.part_id))]
    : [];
  const [fits, lineCands, findingCands, holdersRes] = await Promise.all([
    Promise.all(live.map((l) => supabase.rpc("fit_badge", { p_line_id: l.id }))),
    Promise.all(live.map((l) => (isDraft ? supabase.rpc("line_candidates", { p_line_id: l.id }) : null))),
    Promise.all(unresolved.map((f) => (isDraft ? supabase.rpc("finding_candidates", { p_finding_id: f.id }) : null))),
    uncoveredParts.length > 0
      ? supabase
          .from("job_card_lines")
          .select("id, part_id, qty_reserved, job_card_id, card:job_cards(code, status, bike:bikes(reg_no, status))")
          .eq("workshop_id", row.workshop_id)
          .in("part_id", uncoveredParts)
          .neq("job_card_id", id)
          .gt("qty_reserved", 0)
          .order("id")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const res of [...fits, ...lineCands, ...findingCands, holdersRes]) if (res?.error) throw res.error;
  const holderRows = holdersRes.data ?? [];
  const blockedRes =
    holderRows.length > 0
      ? await supabase
          .from("v_blocked_bikes")
          .select("job_card_id")
          .in("job_card_id", [...new Set(holderRows.map((h) => h.job_card_id))])
      : { data: [], error: null };
  if (blockedRes.error) throw blockedRes.error;
  const blockedCards = new Set((blockedRes.data ?? []).map((b) => b.job_card_id));

  // Draft edits (SPEC §5.2): finding types for "Edit findings" (active ones, plus any the bike
  // already has so nothing is dropped silently) and the model's variants for "Set variant".
  const [typesRes, variantsRes] = await Promise.all([
    isDraft
      ? supabase.from("finding_types").select("id, code, label_en, label_hi, area, is_active").order("label_en")
      : Promise.resolve({ data: [], error: null }),
    isDraft && !bike.variant_id
      ? supabase
          .from("model_variants")
          .select("id, name, year_from, year_to")
          .eq("model_id", bike.model_id)
          .order("year_from")
          .order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (typesRes.error) throw typesRes.error;
  if (variantsRes.error) throw variantsRes.error;
  const usedTypes = new Set(findings.map((f) => f.finding_type_id));
  const findingTypes = (typesRes.data ?? []).filter((ft) => ft.is_active || usedTypes.has(ft.id));

  const etaByLine = new Map((etaRes.data ?? []).map((e) => [e.line_id as string, e]));
  const lineIndex = new Map(live.map((l, i) => [l.id, i]));
  const lineViews: LineView[] = lines
    .filter((l) => l.part)
    .map((l) => {
      const i = lineIndex.get(l.id);
      const holders: Holder[] = holderRows
        .filter((h) => h.part_id === l.part_id && h.card?.status === "confirmed" && h.card.bike)
        .map((h) => ({
          line_id: h.id,
          card_code: h.card!.code,
          reg_no: h.card!.bike!.reg_no,
          bike_status: h.card!.bike!.status,
          qty_reserved: h.qty_reserved,
          blocked: blockedCards.has(h.job_card_id),
        }));
      return {
        id: l.id,
        part_id: l.part_id,
        sku: l.part!.sku,
        name: l.part!.name,
        name_hi: l.part!.name_hi,
        uom: l.part!.uom,
        is_universal: l.part!.is_universal,
        qty_required: l.qty_required,
        qty_reserved: l.qty_reserved,
        qty_issued: l.qty_issued,
        qty_returned: l.qty_returned,
        status: l.status ?? "needed",
        source: l.source,
        cancelled: Boolean(l.cancelled_at),
        fit: i === undefined ? null : (fits[i].data?.[0] ?? null),
        eta: etaByLine.get(l.id) ?? null,
        candidates: i === undefined ? [] : (lineCands[i]?.data ?? []),
        holders,
      };
    })
    .sort((a, b) => LINE_ORDER[a.status] - LINE_ORDER[b.status]);


  const skuByLine = new Map(lineViews.map((l) => [l.id, l.sku]));
  const unresolvedIndex = new Map(unresolved.map((f, i) => [f.id, i]));
  const findingViews: FindingView[] = findings.map((f) => {
    const i = unresolvedIndex.get(f.id);
    return {
      id: f.id,
      finding_type_id: f.finding_type_id,
      code: f.code,
      label: lang === "hi" ? f.label_hi : f.label_en,
      area: f.area,
      qty: f.qty,
      notes: f.notes,
      line_id: f.job_card_line_id,
      line_sku: f.job_card_line_id ? (skuByLine.get(f.job_card_line_id) ?? null) : null,
      no_part_reason: f.no_part_reason,
      part_type: f.applicable_part_type,
      candidates: i === undefined ? [] : (findingCands[i]?.data ?? []),
    };
  });

  const card: CardView = {
    id: row.id,
    workshop_id: row.workshop_id,
    workshop_code: workshopCode,
    code: row.code,
    status: row.status,
    needed_by: row.needed_by,
    needs_review_reason: row.needs_review_reason,
    bike_id: row.bike_id,
    reg_no: bike.reg_no,
    bike_status: bike.status,
    variant_id: bike.variant_id,
    model_id: bike.model_id,
    mfg_year: bike.mfg_year,
    bike_label: [bike.model?.make, bike.model?.model, bike.variant?.name, bike.mfg_year].filter(Boolean).join(" "),
    open_card_id: openRes.data?.id ?? null,
  };
  const history = historyRes.data ?? [];

  return (
    <>
      <PageHeader
        title={`${row.code} · ${bike.reg_no}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge enum="job_card_status" value={row.status} />
            <StatusBadge enum="bike_status" value={bike.status} />
            <span>
              {bike.model?.make} {bike.model?.model} · {bike.variant?.name ?? t("bikes.unknownVariant")} · {bike.mfg_year}
            </span>
          </span>
        }
      />

      <div className="flex flex-col gap-6">
        {card.needs_review_reason && isConfirmed && <NeedsReviewBanner card={card} userId={user.id} />}

        <section className="flex flex-col gap-3 rounded-xl border p-3">
          <NeededBy card={card} userId={user.id} />
          <CardActions
            card={card}
            lines={lineViews.filter((l) => !l.cancelled)}
            findings={findingViews}
            userId={user.id}
            openCardHref={card.open_card_id ? link(`/job-cards/${card.open_card_id}`) : null}
            cardHref={link("/job-cards/{id}")}
          />
        </section>

        {isDraft && !card.variant_id && <SetVariant card={card} variants={variantsRes.data ?? []} userId={user.id} />}

        <Findings
          card={card}
          findings={findingViews}
          userId={user.id}
          edit={isDraft && <EditFindings card={card} findings={findingViews} findingTypes={findingTypes} userId={user.id} />}
        />

        <Lines card={card} lines={lineViews} userId={user.id} />

        <section aria-labelledby="history" className="flex flex-col gap-2">
          <h2 id="history" className="text-lg font-semibold">
            {t("jobCard.history")}
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("jobCard.noHistory")}</p>
          ) : (
            <ol className="flex flex-col divide-y rounded-xl border" data-testid="history">
              {history.map((h) => {
                const key = `history.actions.${h.action}`;
                return (
                  <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 p-3 text-sm">
                    <span className="min-w-0 break-words">
                      <span className="font-medium">{h.user_full_name ?? t("jobCard.system")}</span>{" "}
                      {isMessageKey(key) ? t(key) : h.action}
                    </span>
                    <time dateTime={h.created_at} className="text-muted-foreground tabular-nums">
                      {formatIST(h.created_at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <p>
          <Link href={link("/bikes")} className="text-sm underline underline-offset-4">
            {t("jobCard.backToBikes")}
          </Link>
        </p>
      </div>
    </>
  );
}
