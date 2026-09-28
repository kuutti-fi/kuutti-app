import { defineConfig } from "vitest/config";

// Vitest owns apps/api and packages/*. React Native components use jest-expo.
// Tests run against a real Postgres: DATABASE_URL, or the local default in the harness.
export default defineConfig({
  test: {
    // The command lines under scripts/ have tests of their own (#73).
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15_000,
  },
});
