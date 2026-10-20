import type { Metadata } from "next";
import { requireRole, type SearchParams } from "@/lib/auth";
import { CardFinder } from "../card-finder";

export const metadata: Metadata = { title: "Returns · Vutto Parts" };

/** Find the bike a part comes back from (SPEC §8.2: confirmed cards with parts issued). */
export default async function ReturnListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await requireRole("/store/return", sp);
  return <CardFinder mode="return" ctx={ctx} sp={sp} />;
}
