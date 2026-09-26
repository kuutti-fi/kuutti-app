import { PreferencesResponse } from "@kuutti/schema";
import { describe, expect } from "vitest";
import { createApp } from "../app.ts";
import { signedInAccount } from "../test/account.ts";
import { captureLogger, type TestContext, test, testConfig } from "../test/harness.ts";

// features/matching/preferences.feature (#46): the two hard rows.

async function appWith(ctx: TestContext) {
  const { logger, lines } = await captureLogger();
  return { app: createApp({ config: testConfig(), logger, db: ctx.client }), logs: lines };
}
type App = Awaited<ReturnType<typeof appWith>>["app"];

const put = (app: App, headers: Record<string, string>, body: unknown) =>
  app.request("/preferences", {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("The hard rows refuse what matching cannot use", () => {
  test.for([
    ["none", 25, 35],
    ["women", 17, 35],
    ["women", 25, 100],
    ["women", 35, 25],
    ["women,women", 25, 35],
  ] as const)("seeks %s, %i to %i", async ([seeks, min, max], { ctx }) => {
    const { app } = await appWith(ctx);
    const a = await signedInAccount(ctx.client);
    const body = {
      seeks: seeks === "none" ? [] : seeks.split(",").map(() => "woman"),
      ageWindow: { min, max },
    };
    const response = await put(app, a.headers, body);
    expect(response.status).toBe(400);
    const { rows } = await ctx.client.query("SELECT 1 FROM preferences WHERE account_id = $1", [
      a.accountId,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("preferences", () => {
  test("Seeks and the age window are stored as hard rows and read back", async ({ ctx }) => {
    const { app, logs } = await appWith(ctx);
    const a = await signedInAccount(ctx.client);
    const wanted = { seeks: ["woman", "non_binary"], ageWindow: { min: 25, max: 35 } };
    const saved = await put(app, a.headers, wanted);
    expect(saved.status).toBe(200);
    expect(PreferencesResponse.parse(await saved.json())).toEqual(wanted);
    const read = await app.request("/preferences", { headers: a.headers });
    expect(PreferencesResponse.parse(await read.json())).toEqual(wanted);
    const { rows } = await ctx.client.query<{ field: string; mode: string }>(
      "SELECT field, mode FROM preferences WHERE account_id = $1 ORDER BY field",
      [a.accountId],
    );
    expect(rows).toEqual([
      { field: "age_window", mode: "hard" },
      { field: "seeks", mode: "hard" },
    ]);
    // A second save replaces, never duplicates.
    await put(app, a.headers, { ...wanted, ageWindow: { min: 30, max: 40 } });
    const again = await ctx.client.query("SELECT 1 FROM preferences WHERE account_id = $1", [
      a.accountId,
    ]);
    expect(again.rows).toHaveLength(2);
    // Whom a person seeks never reaches a log line (rule 5).
    expect(JSON.stringify(logs())).not.toContain("non_binary");
  });

  test("The preferences of another account are never served", async ({ ctx }) => {
    const { app } = await appWith(ctx);
    const a = await signedInAccount(ctx.client);
    const b = await signedInAccount(ctx.client);
    await put(app, a.headers, { seeks: ["man"], ageWindow: { min: 20, max: 30 } });
    const theirs = await app.request("/preferences", { headers: b.headers });
    expect(PreferencesResponse.parse(await theirs.json())).toEqual({
      seeks: null,
      ageWindow: null,
    });
    expect((await app.request("/preferences")).status).toBe(401);
  });
});
