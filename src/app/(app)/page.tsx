import { redirect } from "next/navigation";
import { getSessionContext, type SearchParams } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";

// Home: managers and admin go to the blocked board, store keepers to the store. Admin keeps ?ws.
export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getSessionContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.profile) redirect("/no-access");
  const { ws } = await searchParams;
  const keep = ctx.profile.role === "admin" && typeof ws === "string" ? `?ws=${encodeURIComponent(ws)}` : "";
  redirect(`${homeFor(ctx.profile.role)}${keep}`);
}
