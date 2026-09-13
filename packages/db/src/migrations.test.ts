import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJournal } from "./journal.ts";
import { migrationsStatus } from "./migrations.ts";
import type { Queryable } from "./pool.ts";

const neverQueried: Queryable = {
  query: () => {
    throw new Error("the database must not be touched when there is no journal");
  },
};

describe("readJournal", () => {
  it("returns null when no migration has been generated", () => {
    expect(readJournal(mkdtempSync(join(tmpdir(), "kuutti-db-")))).toBeNull();
  });

  it("returns the entries of a journal", () => {
    const dir = mkdtempSync(join(tmpdir(), "kuutti-db-"));
    mkdirSync(join(dir, "meta"));
    writeFileSync(
      join(dir, "meta", "_journal.json"),
      JSON.stringify({
        entries: [
          { idx: 0, version: "7", when: 1700000000000, tag: "0000_init", breakpoints: true },
        ],
      }),
    );
    expect(readJournal(dir)?.map((e) => e.tag)).toEqual(["0000_init"]);
  });
});

describe("migrationsStatus", () => {
  it("is current without a journal and does not open a connection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kuutti-db-"));
    await expect(migrationsStatus(neverQueried, dir)).resolves.toEqual({
      state: "current",
      applied: 0,
      pending: [],
    });
  });
});
