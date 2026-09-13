import { defineConfig } from "vitest/config";

// Vitest owns apps/api and packages/*. React Native components use jest-expo.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
