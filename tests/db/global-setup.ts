// Creates the demo users (plus one user with no profile) once, signs each in once, and hands the
// sessions to the test files through provide/inject (local sign-in rate limits, SPEC §17).
import { createClient } from "@supabase/supabase-js";
import type { TestProject } from "vitest/node";
import type { Database } from "../../src/lib/database.types";
import { ensureAuthUser, ensureDemoUsers } from "./demo-users";
import { assertLocal, loadEnv, requireEnv } from "./env";
import { NO_PROFILE_USER, type SessionKey, type StoredSession } from "./sessions";

export default async function setup(project: TestProject) {
  loadEnv();
  assertLocal();

  const url = requireEnv("SUPABASE_URL");
  const target = { url, publishableKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
  const password = requireEnv("DEMO_PASSWORD");
  const admin = createClient<Database>(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const demo = await ensureDemoUsers(admin, target, password);
  const noProfile = await ensureAuthUser(admin, target, NO_PROFILE_USER, password);
  const { error } = await admin.from("profiles").delete().eq("user_id", NO_PROFILE_USER.id);
  if (error) throw error;

  const sessions = {} as Record<SessionKey, StoredSession>;
  for (const [key, s] of Object.entries({ ...demo, no_profile: noProfile })) {
    sessions[key as SessionKey] = { access_token: s.access_token, refresh_token: s.refresh_token };
  }
  project.provide("sessions", sessions);
}
