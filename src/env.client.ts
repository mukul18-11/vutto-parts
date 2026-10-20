import { z } from "zod";

// Public env, validated in next.config (so a bad value fails the build) and again at runtime.
// Next.js inlines only literal process.env.NEXT_PUBLIC_* references into the browser bundle,
// so every variable is named explicitly below; parsing process.env as a whole gives {} in the browser.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

// Keys are trimmed non-empty strings: sb_publishable_…, sb_secret_… or legacy eyJ… JWTs.
const supabaseKey = z.string().trim().min(1);

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/ }))
    .superRefine((value, ctx) => {
      // Only Vercel production must point at the hosted project; CI and local builds use http://127.0.0.1:54321.
      if (process.env.VERCEL_ENV !== "production") return;
      const url = new URL(value);
      if (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname)) {
        ctx.addIssue({ code: "custom", message: "must be an https URL that is not localhost in production" });
      }
    }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseKey.refine((key) => !key.startsWith("sb_secret_"), {
    message: "must be the publishable key, never the secret key",
  }),
  NEXT_PUBLIC_DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  NEXT_PUBLIC_COMMIT_SHA: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || "local"),
});

const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
  NEXT_PUBLIC_COMMIT_SHA: process.env.NEXT_PUBLIC_COMMIT_SHA,
});

if (!parsed.success) {
  throw new Error(`Invalid public environment variables:\n${z.prettifyError(parsed.error)}`);
}

export const clientEnv = parsed.data;
