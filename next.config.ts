import type { NextConfig } from "next";
import { z } from "zod";
// Importing the client env module validates every NEXT_PUBLIC_ variable; a bad value fails the build.
import "./src/env.client";
// Never import src/env.server.ts here: its 'server-only' import throws in plain Node.
import { serverEnvSchema } from "./src/env.server-schema";

const serverEnv = serverEnvSchema.safeParse(process.env);
if (!serverEnv.success) {
  throw new Error(`Invalid server environment variables:\n${z.prettifyError(serverEnv.error)}`);
}

// No cacheComponents / PPR: authenticated pages are always dynamic (CLAUDE.md rule 7).
const nextConfig: NextConfig = {
  experimental: {
    // forbidden() renders "Not available for your role" (forbidden.tsx) for pages a role cannot open.
    authInterrupts: true,
  },
  env: {
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
