import { defineConfig } from "drizzle-kit";

// Migrations are generated from src/schema with `pnpm --filter @kuutti/db generate`
// and never hand-written (non-negotiable rule 10). Schema arrives with issue #4.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema",
  out: "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://kuutti:kuutti@127.0.0.1:5432/kuutti",
  },
});
