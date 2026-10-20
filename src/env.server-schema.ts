import { z } from "zod";

// Schema only: no 'server-only' and no values, so next.config can import it and validate the
// server env at build time. Runtime code reads the parsed values from src/env.server.ts.
export const serverEnvSchema = z
  .object({
    NEXT_PUBLIC_DEMO_MODE: z.enum(["true", "false"]).default("false"),
    // Not trimmed: it is a password.
    DEMO_PASSWORD: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NEXT_PUBLIC_DEMO_MODE === "true" && env.DEMO_PASSWORD === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_PASSWORD"],
        message: "is required when NEXT_PUBLIC_DEMO_MODE=true",
      });
    }
  })
  .transform(({ DEMO_PASSWORD }) => ({ DEMO_PASSWORD }));
