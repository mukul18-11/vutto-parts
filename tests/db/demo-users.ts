// The five demo logins (SPEC §2) and the Admin API routine that creates them (SPEC §12).
// Environment-agnostic: the test globalSetup uses it against local Supabase, and
// scripts/create-demo-users.ts will import it. Never INSERT into auth.users.
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types";

export const WORKSHOP_IDS = {
  NCR: "00000000-0000-0000-0000-0000000000a1",
  JPR: "00000000-0000-0000-0000-0000000000a2",
} as const;

export type DemoUserKey = "admin" | "ncr_manager" | "ncr_store" | "jpr_manager" | "jpr_store";
type Role = Database["public"]["Enums"]["app_role"];

export type DemoUser = {
  key: DemoUserKey;
  id: string;
  email: string;
  role: Role;
  workshopId: string | null;
  fullName: string;
};

export const DEMO_USERS: readonly DemoUser[] = [
  {
    key: "admin",
    id: "00000000-0000-0000-0000-0000000000b0",
    email: "admin@demo.example.com",
    role: "admin",
    workshopId: null,
    fullName: "Demo Admin",
  },
  {
    key: "ncr_manager",
    id: "00000000-0000-0000-0000-0000000000b1",
    email: "ncr.manager@demo.example.com",
    role: "manager",
    workshopId: WORKSHOP_IDS.NCR,
    fullName: "NCR Manager",
  },
  {
    key: "ncr_store",
    id: "00000000-0000-0000-0000-0000000000b2",
    email: "ncr.store@demo.example.com",
    role: "store_keeper",
    workshopId: WORKSHOP_IDS.NCR,
    fullName: "NCR Store Keeper",
  },
  {
    key: "jpr_manager",
    id: "00000000-0000-0000-0000-0000000000b3",
    email: "jpr.manager@demo.example.com",
    role: "manager",
    workshopId: WORKSHOP_IDS.JPR,
    fullName: "JPR Manager",
  },
  {
    key: "jpr_store",
    id: "00000000-0000-0000-0000-0000000000b4",
    email: "jpr.store@demo.example.com",
    role: "store_keeper",
    workshopId: WORKSHOP_IDS.JPR,
    fullName: "JPR Store Keeper",
  },
];

export type AuthTarget = { url: string; publishableKey: string };

async function findUserByEmail(admin: SupabaseClient<Database>, email: string): Promise<User | undefined> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit || data.users.length < 1000) return hit;
  }
}

/** Signs in with a fresh client that keeps nothing on disk. Returns the session, or null. */
export async function signIn(target: AuthTarget, email: string, password: string): Promise<Session | null> {
  const client = createClient(target.url, target.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return error ? null : data.session;
}

/**
 * Ensures an auth user with this fixed id, email and password exists (SPEC §12): a user with the
 * same email but another id is deleted and recreated; the password is updated only when signing
 * in with it fails (an admin password update logs out every session). Returns a live session.
 */
export async function ensureAuthUser(
  admin: SupabaseClient<Database>,
  target: AuthTarget,
  user: { id: string; email: string },
  password: string,
): Promise<Session> {
  const byEmail = await findUserByEmail(admin, user.email);
  if (byEmail && byEmail.id !== user.id) {
    const { error } = await admin.auth.admin.deleteUser(byEmail.id);
    if (error) throw error;
  }

  const { data: byId } = await admin.auth.admin.getUserById(user.id);
  if (!byId?.user) {
    const { error } = await admin.auth.admin.createUser({
      id: user.id,
      email: user.email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
  }

  let session = await signIn(target, user.email, password);
  if (!session) {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      email: user.email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    session = await signIn(target, user.email, password);
  }
  if (!session) throw new Error(`Could not sign in as ${user.email} after resetting its password`);
  return session;
}

/** Writes the profile only if it differs (uses the service_role client). */
export async function ensureProfile(admin: SupabaseClient<Database>, user: DemoUser): Promise<void> {
  const { data, error } = await admin
    .from("profiles")
    .select("full_name, role, workshop_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (data && data.full_name === user.fullName && data.role === user.role && data.workshop_id === user.workshopId) {
    return;
  }
  const { error: upsertError } = await admin.from("profiles").upsert({
    user_id: user.id,
    full_name: user.fullName,
    role: user.role,
    workshop_id: user.workshopId,
  });
  if (upsertError) throw upsertError;
}

/** Ensures all five demo users and their profiles. Returns one live session per user. */
export async function ensureDemoUsers(
  admin: SupabaseClient<Database>,
  target: AuthTarget,
  password: string,
): Promise<Record<DemoUserKey, Session>> {
  const sessions = {} as Record<DemoUserKey, Session>;
  for (const user of DEMO_USERS) {
    sessions[user.key] = await ensureAuthUser(admin, target, user, password);
    await ensureProfile(admin, user);
  }
  return sessions;
}
