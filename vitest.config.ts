import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: true,
    // e2e tests run real git processes; give them room under load
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
