import { WaitlistResponse } from "@kuutti/schema";
import { withMatchingConfig } from "../test/account.ts";
import { captureLogger, describe, expect, type TestContext, test } from "../test/harness.ts";
import { people, pondNamed } from "../test/people.ts";
import { countPonds, ensureFirstSnapshot, takeSnapshot, waitlistJob } from "./waitlist-snapshot.ts";

// features/pond/waitlist.feature (#54, ADR-013): who is counted, and when the
// figures move.

const DAY_1 = new Date("2026-10-05T01:00:00Z"); // 04:00 in Helsinki
const DAY_2 = new Date("2026-10-06T01:00:00Z");
const DAY_3 = new Date("2026-10-07T01:00:00Z");

async function deps(ctx: TestContext, at: Date) {
  const { logger, lines } = await captureLogger();
  return { deps: { db: ctx.client, logger, now: () => at }, lines };
}

const taken = async (ctx: TestContext, at: Date) => takeSnapshot((await deps(ctx, at)).deps);

const listed = async (ctx: TestContext, pond: string) =>
  WaitlistResponse.parse(await (await ctx.app.request("/waitlist")).json()).ponds.find(
    (p) => p.pond.id === pond,
  );

describe("the figures", () => {
  test("Only live accounts with a pond are counted, a shadow-banned one like any other", async ({
    ctx,
  }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-counted");
    await people(ctx.client, pond, 5, { gender: "woman", state: "registered" });
    await people(ctx.client, pond, 4, { gender: "man", state: "active" });
    await people(ctx.client, pond, 1, { gender: "woman", state: "shadow_banned" });
    for (const state of ["paused", "suspended", "deleted"] as const) {
      await people(ctx.client, pond, 1, { gender: "woman", state });
    }
    await people(ctx.client, pond, 1, { gender: "man", state: "active", standing: "banned" });
    await people(ctx.client, null, 1, { gender: "woman", state: "active" });

    const counts = (await countPonds(ctx.client)).get(pond);
    expect(counts).toEqual({ verified: 10, woman: 6, man: 4, nonBinary: 0, finishing: 10 });
  });

  test("a shadow-banned account with a complete profile is not finishing, like an active one", async ({
    ctx,
  }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-shadow");
    const [id] = await people(ctx.client, pond, 1, { gender: "woman", complete: true });
    expect((await countPonds(ctx.client)).get(pond)?.finishing).toBe(0);
    await ctx.client.query("UPDATE account SET state = 'shadow_banned' WHERE id = $1", [id]);
    expect((await countPonds(ctx.client)).get(pond)).toMatchObject({ verified: 1, finishing: 0 });
  });

  test("A profile that is not complete counts as finishing", async ({ ctx }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-finishing");
    await people(ctx.client, pond, 10, { gender: "woman", complete: true });
    await people(ctx.client, pond, 9, { gender: "man", state: "active" });
    await people(ctx.client, pond, 6, { state: "registered" });
    await taken(ctx, DAY_1);
    expect(await listed(ctx, pond)).toMatchObject({ verified: 25, finishing: 15, split: null });
  });

  test("The people finishing are counted in public only when they and the rest are none or at least k", async ({
    ctx,
  }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-finishing-small");
    await people(ctx.client, pond, 3, { gender: "woman", complete: true });
    await people(ctx.client, pond, 9, { gender: "man", state: "active" });
    await taken(ctx, DAY_1);
    expect(await listed(ctx, pond)).toMatchObject({ verified: 12, finishing: null });
  });

  test("a complete profile on an account that is not active yet is still finishing", async ({
    ctx,
  }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-not-active");
    const [id] = await people(ctx.client, pond, 1, { gender: "woman", complete: true });
    await ctx.client.query("UPDATE account SET state = 'registered' WHERE id = $1", [id]);
    expect((await countPonds(ctx.client)).get(pond)?.finishing).toBe(1);
  });

  test("The figures of a pond move only once at least k people have come or gone", async ({
    ctx,
  }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-steps");
    await people(ctx.client, pond, 25, { gender: "woman" });
    expect((await taken(ctx, DAY_1)).day).toBe("2026-10-05");
    const said = await listed(ctx, pond);
    expect(said).toMatchObject({ day: "2026-10-05", verified: 25 });

    await people(ctx.client, pond, 9, { gender: "man" });
    await taken(ctx, DAY_2);
    expect(await listed(ctx, pond)).toEqual(said);

    await people(ctx.client, pond, 1, { gender: "man" });
    await taken(ctx, DAY_3);
    expect(await listed(ctx, pond)).toMatchObject({ day: "2026-10-07", verified: 35 });
  });

  test("The figures do not move between two counts", async ({ ctx }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-between");
    await people(ctx.client, pond, 11, { gender: "woman" });
    await taken(ctx, DAY_1);
    const said = await listed(ctx, pond);
    expect(said?.verified).toBe(11);

    await people(ctx.client, pond, 15, { gender: "woman" });
    expect(await listed(ctx, pond)).toEqual(said);

    await taken(ctx, DAY_2);
    expect(await listed(ctx, pond)).toMatchObject({ day: "2026-10-06", verified: 26 });
  });

  test("one arrival and one departure a day never show, however many days pass", async ({
    ctx,
  }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-quiet");
    await people(ctx.client, pond, 13, { gender: "woman" });
    await people(ctx.client, pond, 12, { gender: "man" });
    await people(ctx.client, pond, 10, { gender: "non_binary" });
    await taken(ctx, DAY_1);
    const said = await listed(ctx, pond);
    expect(said?.split).toEqual({ woman: 13, man: 12, nonBinary: 10 });

    // A woman comes: the total and her cell would each have gone up by one.
    await people(ctx.client, pond, 1, { gender: "woman" });
    await taken(ctx, DAY_2);
    expect(await listed(ctx, pond)).toEqual(said);

    // A non-binary person leaves: the cell is nine now, and the split still stands as it was said.
    await ctx.client.query(
      `UPDATE account SET state = 'paused' WHERE id =
         (SELECT id FROM account WHERE pond_id = $1 AND gender = 'non_binary' LIMIT 1)`,
      [pond],
    );
    await taken(ctx, DAY_3);
    expect(await listed(ctx, pond)).toEqual(said);
  });

  test("figures said under k = 10 stand while k is raised, and are said again unchanged when it returns", async ({
    ctx,
  }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-raised");
    for (const gender of ["woman", "man", "non_binary"] as const) {
      await people(ctx.client, pond, 15, { gender });
    }
    await taken(ctx, DAY_1);
    const said = await listed(ctx, pond);
    expect(said).toMatchObject({ verified: 45, split: { woman: 15, man: 15, nonBinary: 15 } });

    await withMatchingConfig(ctx.client, { waitlist_k: 50 });
    await taken(ctx, DAY_2);
    expect(await listed(ctx, pond)).toMatchObject({ day: null, verified: null, split: null });
    await people(ctx.client, pond, 1, { gender: "woman" });
    await taken(ctx, DAY_3);

    await withMatchingConfig(ctx.client, { waitlist_k: 10 });
    expect(await listed(ctx, pond)).toEqual(said);
  });

  test("a pond that was never said follows every count until it reaches k", async ({ ctx }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-growing");
    await people(ctx.client, pond, 4, { gender: "man" });
    await taken(ctx, DAY_1);
    expect(await listed(ctx, pond)).toMatchObject({ day: null, verified: null });
    await people(ctx.client, pond, 6, { gender: "man" });
    await taken(ctx, DAY_2);
    expect(await listed(ctx, pond)).toMatchObject({ day: "2026-10-06", verified: 10 });
  });

  test("there is one row per pond, zeros included, and no history", async ({ ctx }) => {
    const chosen = await pondNamed(ctx.client, "test-waitlist-chosen");
    const empty = await pondNamed(ctx.client, "test-waitlist-empty");
    await people(ctx.client, chosen, 2, { gender: "man" });
    await taken(ctx, DAY_1);
    await people(ctx.client, chosen, 30, { gender: "man" });
    await taken(ctx, DAY_2);
    const { rows } = await ctx.client.query<{ pond_id: string; verified: number; day: string }>(
      `SELECT pond_id, verified, to_char(day, 'YYYY-MM-DD') AS day
       FROM waitlist_snapshot WHERE pond_id = ANY($1)`,
      [[chosen, empty]],
    );
    expect(rows).toHaveLength(2);
    expect(Object.fromEntries(rows.map((r) => [r.pond_id, [r.verified, r.day]]))).toEqual({
      [chosen]: [32, "2026-10-06"],
      [empty]: [0, "2026-10-05"],
    });
  });

  test("the job logs how many ponds moved, and no figure of any pond", async ({ ctx }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-log");
    await people(ctx.client, pond, 37, { gender: "man" });
    const { deps: d, lines } = await deps(ctx, DAY_1);
    const job = waitlistJob(d);
    expect(job.name).toBe("waitlist-snapshot");
    const result = await job.run();
    expect(result.ponds).toBeGreaterThanOrEqual(1);
    expect(result.moved).toBeGreaterThanOrEqual(1);
    const logged = lines().filter((l) => l.msg === "waitlist snapshot");
    expect(logged).toHaveLength(1);
    const keys = Object.keys(logged[0] ?? {});
    expect(keys).toEqual(expect.arrayContaining(["day", "moved", "ponds"]));
    for (const figure of ["accounts", "verified", "woman", "man", "nonBinary", "finishing"]) {
      expect(keys).not.toContain(figure);
    }
    expect(JSON.stringify(logged)).not.toContain(pond);
  });

  test("the first figures are taken only when there are none", async ({ ctx }) => {
    await ctx.client.query("DELETE FROM waitlist_snapshot");
    await pondNamed(ctx.client, "test-waitlist-first");
    const first = await ensureFirstSnapshot((await deps(ctx, DAY_1)).deps);
    expect(first?.day).toBe("2026-10-05");
    expect(await ensureFirstSnapshot((await deps(ctx, DAY_2)).deps)).toBeNull();
  });
});
