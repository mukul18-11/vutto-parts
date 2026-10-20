import { expect, it } from "vitest";
import { DEMO_EMAILS, DEMO_ROLE_KEYS } from "@/lib/demo-accounts";
import { DEMO_USERS } from "../db/demo-users";

it("maps each login button's role key to the SPEC §2 demo email", () => {
  expect([...DEMO_ROLE_KEYS].sort()).toEqual(DEMO_USERS.map((u) => u.key).sort());
  for (const user of DEMO_USERS) expect(DEMO_EMAILS[user.key]).toBe(user.email);
});
