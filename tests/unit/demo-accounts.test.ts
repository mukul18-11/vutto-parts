import { expect, it } from "vitest";
import { DEMO_EMAILS, DEMO_ROLE_KEYS, DEMO_USER_IDS, demoEmailFor } from "@/lib/demo-accounts";
import { DEMO_USERS } from "../db/demo-users";

it("maps each login button's role key to the SPEC §2 demo email", () => {
  expect([...DEMO_ROLE_KEYS].sort()).toEqual(DEMO_USERS.map((u) => u.key).sort());
  for (const user of DEMO_USERS) expect(DEMO_EMAILS[user.key]).toBe(user.email);
});

it("maps each demo user id (the fixed SPEC §2 ids) to its email", () => {
  for (const user of DEMO_USERS) {
    expect(DEMO_USER_IDS[user.key]).toBe(user.id);
    expect(demoEmailFor(user.id)).toBe(user.email);
  }
  expect(demoEmailFor("00000000-0000-0000-0000-0000000000ff")).toBeNull();
});
