import { existsSync } from "node:fs";

/** Loads .env into process.env (existing variables win). CI sets real env vars instead. */
export function loadEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

/** Throws unless the tests point at local Supabase (SPEC §17). Every helper calls it first. */
export function assertLocal(): void {
  const url = process.env.SUPABASE_URL;
  if (url !== "http://127.0.0.1:54321") {
    throw new Error(`Refusing to run: SUPABASE_URL must be http://127.0.0.1:54321, got ${url}`);
  }
  const db = process.env.DATABASE_URL;
  const host = db ? new URL(db).hostname : undefined;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run: DATABASE_URL host must be 127.0.0.1 or localhost, got ${host}`);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name} (see .env.example)`);
  return value;
}
