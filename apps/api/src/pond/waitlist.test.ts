import { WaitlistResponse } from "@kuutti/schema";
import { createApp } from "../app.ts";
import { takeSnapshot } from "../jobs/waitlist-snapshot.ts";
import { signedInAccount, withMatchingConfig } from "../test/account.ts";
import {
  captureLogger,
  describe,
  expect,
  type TestContext,
  test,
  testConfig,
} from "../test/harness.ts";
import { people, pondNamed } from "../test/people.ts";
import { WAITLIST_CACHE_CONTROL } from "./routes.ts";

// features/pond/waitlist.feature (#54, ADR-013): what the public may read.

const DAY = new Date("2026-10-05T01:00:00Z");

async function taken(ctx: TestContext) {
  const { logger } = await captureLogger();
  await takeSnapshot({ db: ctx.client, logger, now: () => DAY });
}

const read = async (ctx: TestContext) =>
  WaitlistResponse.parse(await (await ctx.app.request("/waitlist")).json());

describe("the waitlist", () => {
  test("A pond below k publishes no number", async ({ ctx }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-nine");
    await people(ctx.client, pond, 9, { gender: "woman" });
    await taken(ctx);
    const body = await read(ctx);
    expect(body.k).toBe(10);
    expect(body.ponds.find((p) => p.pond.id === pond)).toMatchObject({
      day: null,
      verified: null,
      split: null,
      finishing: null,
    });
  });

  describe("The gender split is published only when every cell is at least k", () => {
    test.for([
      { women: 12, men: 11, nonBinary: 10, undeclared: 0, split: "published" },
      { women: 12, men: 11, nonBinary: 10, undeclared: 10, split: "published" },
      { women: 12, men: 11, nonBinary: 10, undeclared: 4, split: "hidden" },
      { women: 12, men: 11, nonBinary: 3, undeclared: 0, split: "hidden" },
      { women: 12, men: 11, nonBinary: 0, undeclared: 0, split: "hidden" },
      { women: 12, men: 0, nonBinary: 0, undeclared: 0, split: "hidden" },
    ])(
      "$women women, $men men, $nonBinary non-binary, $undeclared undeclared: the split is $split",
      async ({ women, men, nonBinary, undeclared, split }, { ctx }) => {
        const pond = await pondNamed(
          ctx.client,
          `test-waitlist-split-${women}-${men}-${nonBinary}-${undeclared}`,
        );
        await people(ctx.client, pond, women, { gender: "woman" });
        await people(ctx.client, pond, men, { gender: "man" });
        await people(ctx.client, pond, nonBinary, { gender: "non_binary" });
        await people(ctx.client, pond, undeclared, { gender: null });
        await taken(ctx);
        const listed = (await read(ctx)).ponds.find((p) => p.pond.id === pond);
        expect(listed?.verified).toBe(women + men + nonBinary + undeclared);
        if (split === "published") {
          expect(listed?.split).toEqual({ woman: women, man: men, nonBinary });
        } else {
          expect(listed?.split).toBeNull();
        }
      },
    );
  });

  test("The waitlist answers without a session and names nobody", async ({ ctx }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-public");
    const ids = await people(ctx.client, pond, 12, { gender: "woman", complete: true });
    const someone = await signedInAccount(ctx.client);
    await taken(ctx);
    const response = await ctx.app.request("/waitlist");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(WAITLIST_CACHE_CONTROL);
    const text = await response.text();
    const body = WaitlistResponse.parse(JSON.parse(text));
    expect(Object.keys(body).sort()).toEqual(["k", "ponds"]);
    expect(body.ponds.find((p) => p.pond.id === pond)).toEqual({
      pond: expect.objectContaining({ id: pond }),
      day: "2026-10-05",
      verified: 12,
      // Everyone here declared the same: the split would say it of each of them.
      split: null,
      finishing: 0,
    });
    for (const id of [...ids, someone.accountId]) expect(text).not.toContain(id);
    expect(text).not.toMatch(/T\d\d:\d\d/); // a day, never a time of day
    expect(text).not.toContain("Aino");
    expect(text).not.toContain("bio");
    // The same answer with a session: the route reads nothing of the caller.
    const signedIn = await ctx.app.request("/waitlist", { headers: someone.headers });
    expect(await signedIn.text()).toBe(text);
  });

  test("k comes from matching_config, and a larger k publishes less", async ({ ctx }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-k");
    await people(ctx.client, pond, 16, { gender: "man" });
    await taken(ctx);
    expect((await read(ctx)).ponds.find((p) => p.pond.id === pond)?.verified).toBe(16);
    await withMatchingConfig(ctx.client, { waitlist_k: 20 });
    const body = await read(ctx);
    expect(body.k).toBe(20);
    expect(body.ponds.find((p) => p.pond.id === pond)).toMatchObject({
      day: null,
      verified: null,
      split: null,
      finishing: null,
    });
  });

  test("a k below the floor in matching_config publishes nothing more: the floor holds", async ({
    ctx,
  }) => {
    const pond = await pondNamed(ctx.client, "test-waitlist-floor");
    await people(ctx.client, pond, 3, { gender: "woman" });
    await people(ctx.client, pond, 3, { gender: "man" });
    await people(ctx.client, pond, 3, { gender: "non_binary" });
    await withMatchingConfig(ctx.client, { waitlist_k: 1 });
    await taken(ctx);
    const body = await read(ctx);
    expect(body.k).toBe(10);
    expect(body.ponds.find((p) => p.pond.id === pond)).toMatchObject({
      verified: null,
      split: null,
      finishing: null,
    });
  });

  test("a failure is not answered as something a cache may keep", async ({ ctx }) => {
    await withMatchingConfig(ctx.client, { waitlist_k: "ten" });
    const response = await ctx.app.request("/waitlist");
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBeNull();
  });

  test("before any figures exist every pond is listed with no number and no day", async ({
    ctx,
  }) => {
    await ctx.client.query("DELETE FROM waitlist_snapshot");
    const pond = await pondNamed(ctx.client, "test-waitlist-none");
    await people(ctx.client, pond, 30, { gender: "woman" });
    const body = await read(ctx);
    expect(body.ponds.find((p) => p.pond.id === pond)).toEqual({
      pond: expect.objectContaining({ id: pond }),
      day: null,
      verified: null,
      split: null,
      finishing: null,
    });
  });

  test("a browser origin is answered only from the allowlist, and caches are told the answer varies by it", async ({
    ctx,
  }) => {
    const { logger } = await captureLogger();
    const app = createApp({
      config: testConfig({ CORS_ALLOWED_ORIGINS: "https://kuutti.app" }),
      logger,
      db: ctx.client,
    });
    const site = await app.request("/waitlist", { headers: { origin: "https://kuutti.app" } });
    expect(site.headers.get("access-control-allow-origin")).toBe("https://kuutti.app");
    const other = await app.request("/waitlist", {
      headers: { origin: "https://scraper.example" },
    });
    expect(other.status).toBe(200);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const none = await app.request("/waitlist");
    // The answer is cacheable, so every form of it must say what it varies by:
    // a cache that kept the site's answer must not hand its header to another origin.
    for (const response of [site, other, none]) {
      expect(response.headers.get("cache-control")).toBe(WAITLIST_CACHE_CONTROL);
      expect(response.headers.get("vary") ?? "").toMatch(/\bOrigin\b/i);
    }
  });
});
