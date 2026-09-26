import { PondList } from "@kuutti/schema";
import { describe, expect } from "vitest";
import { createApp } from "../app.ts";
import { signedInAccount } from "../test/account.ts";
import { captureLogger, type TestContext, test, testConfig } from "../test/harness.ts";

// features/pond/choice.feature (#46). Ponds are inserted inside the test's
// transaction: the test database is migrated, not seeded.

async function appWith(ctx: TestContext) {
  const { logger } = await captureLogger();
  return createApp({ config: testConfig(), logger, db: ctx.client });
}

async function pond(ctx: TestContext, slug: string, parentId: string | null = null) {
  const { rows } = await ctx.client.query<{ id: string }>(
    `INSERT INTO ponds (slug, name_nominative, name_inessive, parent_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      slug,
      slug === "test-otaniemi" ? "Otaniemi" : "Espoo",
      slug === "test-otaniemi" ? "Otaniemessä" : "Espoossa",
      parentId,
    ],
  );
  return rows[0]?.id ?? "";
}

describe("pond choice", () => {
  test("The pond list carries both case forms", async ({ ctx }) => {
    const app = await appWith(ctx);
    const a = await signedInAccount(ctx.client);
    const espoo = await pond(ctx, "test-espoo");
    const otaniemi = await pond(ctx, "test-otaniemi", espoo);
    const response = await app.request("/ponds", { headers: a.headers });
    expect(response.status).toBe(200);
    const { ponds } = PondList.parse(await response.json());
    const found = ponds.find((p) => p.id === otaniemi);
    expect(found).toEqual({
      id: otaniemi,
      slug: "test-otaniemi",
      name: "Otaniemi",
      nameInessive: "Otaniemessä",
      parentId: espoo,
    });
    // Parents come first.
    expect(ponds.findIndex((p) => p.id === espoo)).toBeLessThan(
      ponds.findIndex((p) => p.id === otaniemi),
    );
  });

  test("A pond is chosen from the list and an unknown id is refused", async ({ ctx }) => {
    const app = await appWith(ctx);
    const a = await signedInAccount(ctx.client);
    const otaniemi = await pond(ctx, "test-otaniemi");
    const choose = (pondId: string) =>
      app.request("/account/pond", {
        method: "PUT",
        headers: { ...a.headers, "content-type": "application/json" },
        body: JSON.stringify({ pondId }),
      });
    expect((await choose(otaniemi)).status).toBe(204);
    const { rows } = await ctx.client.query<{ pond_id: string }>(
      "SELECT pond_id FROM account WHERE id = $1",
      [a.accountId],
    );
    expect(rows[0]?.pond_id).toBe(otaniemi);
    const refused = await choose("00000000-0000-4000-8000-000000000009");
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("pond_unknown");
    const after = await ctx.client.query<{ pond_id: string }>(
      "SELECT pond_id FROM account WHERE id = $1",
      [a.accountId],
    );
    expect(after.rows[0]?.pond_id).toBe(otaniemi);
  });

  test("unauthenticated: 401 on the pond routes", async ({ ctx }) => {
    const app = await appWith(ctx);
    expect((await app.request("/ponds")).status).toBe(401);
    expect((await app.request("/account/pond", { method: "PUT" })).status).toBe(401);
  });
});
