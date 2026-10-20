import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Integration tests against local Supabase only (every helper calls assertLocal()).
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          globalSetup: ["tests/db/global-setup.ts"],
          setupFiles: ["tests/db/setup-env.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
