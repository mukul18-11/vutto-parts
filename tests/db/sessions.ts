import type { DemoUserKey } from "./demo-users";

/** Test-only user with an auth account but no profile row. */
export const NO_PROFILE_USER = {
  id: "00000000-0000-0000-0000-0000000000c0",
  email: "no.profile@test.example.com",
} as const;

export type SessionKey = DemoUserKey | "no_profile";
export type StoredSession = { access_token: string; refresh_token: string };

declare module "vitest" {
  export interface ProvidedContext {
    sessions: Record<SessionKey, StoredSession>;
  }
}
