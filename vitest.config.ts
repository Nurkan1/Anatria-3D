import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config.ts";

// Vitest 4 keeps its config separate from Vite's — `test` is no longer a valid
// key on Vite's own `defineConfig`. Merging keeps the aliases and plugins in
// one place.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    },
  }),
);
