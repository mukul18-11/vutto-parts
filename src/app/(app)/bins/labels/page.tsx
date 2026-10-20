import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { z } from "zod";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireRole, type SearchParams } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { withWs } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Bin labels · Vutto Parts" };

// The QR label contains exactly the bin code (SPEC §3.1); rendered as SVG on the server.
const BIN_CODE = /^(NCR|JPR)-([A-Z][0-9]{2}-[0-9]{2}|RCV|QRN)$/;

export default async function BinLabelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { profile, workshop } = await requireRole("/bins/labels", sp);
  const t = await getT();
  const binId = typeof sp.bin === "string" && z.guid().safeParse(sp.bin).success ? sp.bin : null;
  const link = (href: string) => withWs(href, profile.role, workshop.code);

  let query = (await createClient())
    .from("bins")
    .select("id, code")
    .eq("workshop_id", workshop.id)
    .eq("is_active", true)
    .order("code");
  if (binId) query = query.eq("id", binId);
  const { data, error } = await query;
  if (error) throw error;

  const labels = await Promise.all(
    data
      .filter((b) => BIN_CODE.test(b.code))
      .map(async (b) => ({
        id: b.id,
        code: b.code,
        svg: await QRCode.toString(b.code, { type: "svg", errorCorrectionLevel: "M", margin: 1 }),
      })),
  );

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={t("pages.binLabels")}
          subtitle={`${workshop.name} (${workshop.code}) · ${t("labels.count", { n: labels.length })}`}
          actions={
            <>
              {binId && (
                <Button asChild variant="outline" className="h-11">
                  <Link href={link("/bins/labels")}>{t("labels.printAll")}</Link>
                </Button>
              )}
              {labels.length > 0 && <PrintButton />}
            </>
          }
        />
        <p className="mb-4 text-sm text-muted-foreground">{t("labels.hint")}</p>
      </div>
      {labels.length === 0 ? (
        <EmptyState
          message={t("labels.empty")}
          action={
            <Button asChild variant="outline" className="h-11">
              <Link href={link("/catalogue?tab=bins")}>{t("labels.toBins")}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="label-grid grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="labels">
          {labels.map((l) => (
            <li key={l.id} className="label flex flex-col items-center gap-1 rounded-lg border p-3 text-center">
              {/* SVG generated on the server by qrcode from a bin code that matched the strict pattern. */}
              <div className="aspect-square w-full max-w-40 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: l.svg }} />
              <span className="font-mono text-lg font-semibold tracking-wide">{l.code}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
