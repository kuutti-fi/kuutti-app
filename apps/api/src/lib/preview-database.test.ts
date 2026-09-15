import { createPool } from "@kuutti/db";
import { afterAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "../test/harness.ts";
import {
  ensurePreviewDatabase,
  PREVIEW_DATABASE_PATTERN,
  previewDatabaseName,
} from "./preview-database.ts";

describe("previewDatabaseName", () => {
  it("is kuutti_pr_<n> for a pull request number", () => {
    expect(previewDatabaseName("12")).toBe("kuutti_pr_12");
    expect(PREVIEW_DATABASE_PATTERN.test("kuutti_pr_12")).toBe(true);
  });

  it("refuses anything that is not a pull request number", () => {
    for (const bad of ["", "12; DROP DATABASE kuutti", "12345678", "kuutti", "1e3", "-1"]) {
      expect(() => previewDatabaseName(bad)).toThrow(/not a preview database name/);
    }
  });
});

describe("ensurePreviewDatabase", () => {
  // Needs CREATEDB on the test role, which compose and the CI service grant.
  const admin = createPool({ connectionString: TEST_DATABASE_URL, max: 1 });
  // Unique per worker without random data (CLAUDE.md Testing): the process id.
  const name = `kuutti_pr_${process.pid % 1_000_000}`;

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it("creates the database once and reports it afterwards", async () => {
    expect(await ensurePreviewDatabase(admin, name)).toBe("created");
    expect(await ensurePreviewDatabase(admin, name)).toBe("exists");
    const row = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    expect(row.rowCount).toBe(1);
  });

  it("refuses a name outside the preview pattern before touching the database", async () => {
    await expect(ensurePreviewDatabase(admin, "kuutti")).rejects.toThrow(
      /not a preview database name/,
    );
    await expect(ensurePreviewDatabase(admin, 'kuutti_pr_1"; DROP DATABASE x')).rejects.toThrow(
      /not a preview database name/,
    );
  });
});
