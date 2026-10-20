"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { clientEnv } from "@/env.client";
import { serverEnv } from "@/env.server";
import { DEMO_EMAILS, demoRoleKeySchema } from "@/lib/demo-accounts";
import { LANG_COOKIE, type MessageKey } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error: MessageKey | null; email?: string };

// Only same-origin paths: "/store?ws=NCR" yes, "//evil.example" and "https://…" no.
const nextSchema = z
  .string()
  .regex(/^\/(?!\/)[^\\]*$/)
  .optional()
  .catch(undefined);

const inputSchema = z.union([
  z.object({ role: demoRoleKeySchema }),
  z.object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
    password: z.string().min(1).max(200),
  }),
]);

/**
 * Signs in with email + password, or with a demo role key (SPEC §12): the key maps to the §2
 * email and DEMO_PASSWORD is read on the server, so the password never reaches the browser.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const next = nextSchema.parse(formData.get("next") || undefined);
  const role = formData.get("role");
  const parsed = inputSchema.safeParse(
    role !== null ? { role } : { email: formData.get("email"), password: formData.get("password") },
  );
  if (!parsed.success) return { error: "login.wrongPassword", email: String(formData.get("email") ?? "") };

  const isDemo = "role" in parsed.data;
  try {
    let email: string;
    let password: string;
    if ("role" in parsed.data) {
      if (!clientEnv.NEXT_PUBLIC_DEMO_MODE || !serverEnv.DEMO_PASSWORD) return { error: "login.failed" };
      email = DEMO_EMAILS[parsed.data.role];
      password = serverEnv.DEMO_PASSWORD;
    } else {
      ({ email, password } = parsed.data);
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const invalid = error.code === "invalid_credentials" || error.status === 400;
      if (!invalid) console.error("signIn failed", error.status, error.code);
      if (isDemo) return { error: invalid ? "login.demoPasswordChanged" : "login.failed" };
      return { error: invalid ? "login.wrongPassword" : "login.failed", email };
    }

    // The Jaipur store keeper demo starts in Hindi.
    if ("role" in parsed.data && parsed.data.role === "jpr_store") {
      const store = await cookies();
      store.set(LANG_COOKIE, "hi", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    }
  } catch (e) {
    unstable_rethrow(e);
    console.error("signIn threw", e instanceof Error ? e.message : e);
    return { error: "login.failed" };
  }

  // Outside the try/catch: redirect() works by throwing.
  redirect(next ?? "/");
}
