// Clients for DB integration tests. Behaviour tests act as the real demo users (never as
// service_role); the pg connection (postgres) is for catalog checks, fixtures and test_clear.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { inject } from "vitest";
import type { Database } from "../../src/lib/database.types";
import { assertLocal, requireEnv } from "./env";
import type { SessionKey } from "./sessions";

export type Client = SupabaseClient<Database>;

function newClient(): Client {
  assertLocal();
  return createClient<Database>(requireEnv("SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** A client signed in as one of the cached sessions from globalSetup. */
export async function clientAs(key: SessionKey): Promise<Client> {
  const client = newClient();
  const { error } = await client.auth.setSession(inject("sessions")[key]);
  if (error) throw error;
  return client;
}

export function anonClient(): Client {
  return newClient();
}

/** A connected postgres client. Call end() in afterAll. */
export async function pgClient(): Promise<pg.Client> {
  assertLocal();
  const client = new pg.Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();
  return client;
}
