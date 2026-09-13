import { defineConfig } from "vitest/config";

// Vitest owns apps/api and packages/*. React Native components use jest-expo.
// Tests run against a real Postgres: DATABASE_URL, or the local default in the harness.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15_000,
  },
});
