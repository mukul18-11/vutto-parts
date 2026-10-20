import type { Metadata } from "next";
import { requireRole, type SearchParams } from "@/lib/auth";
import { CardFinder } from "../card-finder";

export const metadata: Metadata = { title: "Ready to issue · Vutto Parts" };

/** Bikes with reserved parts, in_repair first (SPEC §14 store issue queue). */
export default async function IssueListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await requireRole("/store/issue", sp);
  return <CardFinder mode="issue" ctx={ctx} sp={sp} />;
}
