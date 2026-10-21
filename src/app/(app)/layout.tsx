import { redirect } from "next/navigation";
import { AppFooter } from "@/components/app-shell/footer";
import { AppHeader } from "@/components/app-shell/header";
import { ResetBanner } from "@/components/app-shell/reset-banner";
import { getDemoMeta, getSessionContext } from "@/lib/auth";
import { readSchemaVersion } from "@/lib/health";
import { isRecentReset } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/time";

// Authenticated pages always render per request (CLAUDE.md rule 7).
export const dynamic = "force-dynamic";

// The shell only: route guards run at the top of each page (requireRole), because a layout gets
// no searchParams or pathname and does not re-render between sibling pages.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // At most two sequential round trips: session + demo_meta, then the admin/reset extras.
  const [ctx, meta] = await Promise.all([getSessionContext(), getDemoMeta()]);
  if (!ctx.user) redirect("/login");
  if (!ctx.profile) redirect("/no-access");

  const isAdmin = ctx.profile.role === "admin";
  // "Demo data reset by Admin at 11:02 IST" for an hour after a reset. Everyone can read admin
  // profiles (RLS), so the name resolves for every role.
  const lastResetAt = meta?.last_reset_at ?? null;
  const lastResetBy = meta?.last_reset_by ?? null;
  const recentReset = isRecentReset(lastResetAt, requestNow());
  const supabase = await createClient();
  const [health, resetBy] = await Promise.all([
    isAdmin ? supabase.rpc("health") : Promise.resolve(null),
    recentReset && lastResetBy
      ? supabase.from("profiles").select("full_name").eq("user_id", lastResetBy).maybeSingle()
      : Promise.resolve(null),
  ]);
  const schemaVersion = readSchemaVersion(health?.data);
  const resetByName = resetBy?.data?.full_name ?? null;

  return (
    <div className="flex min-h-dvh flex-col">
      {recentReset && lastResetAt && <ResetBanner at={lastResetAt} by={resetByName} />}
      <AppHeader profile={ctx.profile} workshops={ctx.workshops} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">{children}</main>
      <AppFooter anchorDate={meta?.anchor_date ?? null} admin={isAdmin ? { schemaVersion } : undefined} />
    </div>
  );
}
