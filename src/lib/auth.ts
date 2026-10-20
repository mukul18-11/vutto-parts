import "server-only";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { canAccess, type Role, type RouteKey } from "@/lib/permissions";

export type Workshop = { id: string; code: string; name: string };
export type Profile = { user_id: string; full_name: string; role: Role; workshop_id: string | null };

export type SessionContext =
  | { user: null; profile: null; workshops: Workshop[] }
  | { user: User; profile: null; workshops: Workshop[] }
  | { user: User; profile: Profile; workshops: Workshop[] };

/**
 * The signed-in user and their profile, read on every request (SPEC §2: role and workshop come
 * only from public.profiles). React cache() dedupes within one request only (layout + page);
 * nothing is kept between requests.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { user: null, profile: null, workshops: [] };

  const [profileRes, workshopsRes] = await Promise.all([
    supabase.from("profiles").select("user_id, full_name, role, workshop_id").eq("user_id", auth.user.id).maybeSingle(),
    supabase.from("workshops").select("id, code, name").order("code", { ascending: false }),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (workshopsRes.error) throw workshopsRes.error;
  return { user: auth.user, profile: profileRes.data, workshops: workshopsRes.data };
});

export const WORKSHOP_CODES = ["NCR", "JPR"] as const;
export const DEFAULT_WORKSHOP_CODE = "NCR";

export type SearchParams = Record<string, string | string[] | undefined>;

/** Admin picks a workshop with ?ws=NCR|JPR (default NCR); everyone else has their own. */
export function resolveWorkshop(profile: Profile, workshops: Workshop[], searchParams?: SearchParams): Workshop {
  if (profile.role !== "admin") {
    const own = workshops.find((w) => w.id === profile.workshop_id);
    if (!own) throw new Error("Profile workshop is not readable");
    return own;
  }
  const ws = searchParams?.ws;
  const code = typeof ws === "string" ? ws.toUpperCase() : DEFAULT_WORKSHOP_CODE;
  const picked = workshops.find((w) => w.code === code) ?? workshops.find((w) => w.code === DEFAULT_WORKSHOP_CODE);
  if (!picked) throw new Error("Workshops are not readable");
  return picked;
}

export type PageContext = { user: User; profile: Profile; workshop: Workshop; workshops: Workshop[] };

/**
 * Route guard at the top of every (app) page (layouts get no searchParams and do not re-render
 * between sibling pages). Signed out → /login, no profile → /no-access, role too low → 403.
 */
export async function requireRole(route: RouteKey, searchParams?: SearchParams): Promise<PageContext> {
  const ctx = await getSessionContext();
  if (!ctx.user) redirect(`/login?next=${encodeURIComponent(route)}`);
  if (!ctx.profile) redirect("/no-access");
  if (!canAccess(ctx.profile.role, route)) forbidden();
  return {
    user: ctx.user,
    profile: ctx.profile,
    workshop: resolveWorkshop(ctx.profile, ctx.workshops, searchParams),
    workshops: ctx.workshops,
  };
}
