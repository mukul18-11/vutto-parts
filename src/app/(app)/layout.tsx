import { redirect } from "next/navigation";
import { AppFooter } from "@/components/app-shell/footer";
import { AppHeader } from "@/components/app-shell/header";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Authenticated pages always render per request (CLAUDE.md rule 7).
export const dynamic = "force-dynamic";

// The shell only: route guards run at the top of each page (requireRole), because a layout gets
// no searchParams or pathname and does not re-render between sibling pages.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.profile) redirect("/no-access");

  const isAdmin = ctx.profile.role === "admin";
  const supabase = await createClient();
  const [meta, health] = await Promise.all([
    supabase.from("demo_meta").select("anchor_date").maybeSingle(),
    isAdmin ? supabase.rpc("health") : Promise.resolve(null),
  ]);
  const schemaVersion = readSchemaVersion(health?.data);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader profile={ctx.profile} workshops={ctx.workshops} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">{children}</main>
      <AppFooter anchorDate={meta.data?.anchor_date ?? null} admin={isAdmin ? { schemaVersion } : undefined} />
    </div>
  );
}

function readSchemaVersion(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("schema_version" in data)) return null;
  const version = (data as { schema_version: unknown }).schema_version;
  return typeof version === "string" ? version : null;
}
