import { defineConfig } from "vitest/config";

// Tests run against a real Postgres: DATABASE_URL, or the local default in src/test.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
