import { defineConfig } from "drizzle-kit";

// Migrations are generated from src/schema with `pnpm --filter @kuutti/db generate`
// and never hand-written (non-negotiable rule 10). CI regenerates and fails on a diff.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://kuutti:kuutti@127.0.0.1:5432/kuutti",
  },
});
