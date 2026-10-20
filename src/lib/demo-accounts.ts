// The five demo logins (SPEC §2). A login button posts only the role key; the server action maps
// it to the email and signs in with DEMO_PASSWORD, so the password never reaches the browser.
import { z } from "zod";

export const DEMO_ROLE_KEYS = ["admin", "ncr_manager", "ncr_store", "jpr_manager", "jpr_store"] as const;
export const demoRoleKeySchema = z.enum(DEMO_ROLE_KEYS);
export type DemoRoleKey = z.infer<typeof demoRoleKeySchema>;

export const DEMO_EMAILS: Record<DemoRoleKey, string> = {
  admin: "admin@demo.example.com",
  ncr_manager: "ncr.manager@demo.example.com",
  ncr_store: "ncr.store@demo.example.com",
  jpr_manager: "jpr.manager@demo.example.com",
  jpr_store: "jpr.store@demo.example.com",
};

/** The fixed user ids (SPEC §2), so seeded history and the admin user list show the right login. */
export const DEMO_USER_IDS: Record<DemoRoleKey, string> = {
  admin: "00000000-0000-0000-0000-0000000000b0",
  ncr_manager: "00000000-0000-0000-0000-0000000000b1",
  ncr_store: "00000000-0000-0000-0000-0000000000b2",
  jpr_manager: "00000000-0000-0000-0000-0000000000b3",
  jpr_store: "00000000-0000-0000-0000-0000000000b4",
};

/** The demo login email for a user id, or null for any other user. */
export function demoEmailFor(userId: string): string | null {
  const key = DEMO_ROLE_KEYS.find((k) => DEMO_USER_IDS[k] === userId);
  return key ? DEMO_EMAILS[key] : null;
}
