import { describe, expect, it } from "vitest";
import { captureLogger } from "../test/harness.ts";
import { msUntilNightly, runNightly } from "./nightly.ts";

describe("nightly jobs", () => {
  it("waits until the next 04:00 in Helsinki", () => {
    // Summer time: 04:00 Helsinki is 01:00 UTC.
    expect(msUntilNightly(new Date("2026-07-01T00:00:00Z"))).toBe(60 * 60 * 1000);
    expect(msUntilNightly(new Date("2026-07-01T01:00:00Z"))).toBe(24 * 60 * 60 * 1000);
    expect(msUntilNightly(new Date("2026-07-01T01:00:01Z"))).toBe(24 * 60 * 60 * 1000 - 1000);
    // Winter time: 04:00 Helsinki is 02:00 UTC.
    expect(msUntilNightly(new Date("2026-12-01T00:30:00Z"))).toBe(90 * 60 * 1000);
  });

  it("runs every job and logs a failure without stopping the rest", async () => {
    const { logger, lines } = await captureLogger();
    const ran: string[] = [];
    await runNightly(
      [
        { name: "first", run: async () => ({ rows: 1 }) },
        {
          name: "broken",
          run: async () => {
            throw new Error("boom");
          },
        },
        {
          name: "last",
          run: async () => {
            ran.push("last");
            return {};
          },
        },
      ],
      logger,
    );
    expect(ran).toEqual(["last"]);
    const msgs = lines().map((l) => `${l.job}:${l.msg}`);
    expect(msgs).toEqual([
      "first:nightly job done",
      "broken:nightly job failed",
      "last:nightly job done",
    ]);
  });
});
