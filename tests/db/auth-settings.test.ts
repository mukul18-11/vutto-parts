// Signups and anonymous sign-in are off (SPEC §12; supabase/config.toml mirrors the hosted
// dashboard settings). Demo users exist only through the Admin API.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { anonClient } from "./clients";

describe("auth settings (SPEC §12)", () => {
  it("refuses a self-service sign-up", async () => {
    const { data, error } = await anonClient().auth.signUp({
      email: `probe-${randomUUID()}@test.example.com`,
      password: "probe-password-123456",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("signup_disabled");
    expect(data.user).toBeNull();
    expect(data.session).toBeNull();
  });

  it("refuses an anonymous sign-in", async () => {
    const { data, error } = await anonClient().auth.signInAnonymously();
    expect(error).not.toBeNull();
    expect(error?.code).toBe("anonymous_provider_disabled");
    expect(data.user).toBeNull();
    expect(data.session).toBeNull();
  });
});
