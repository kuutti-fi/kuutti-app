import { describe, expect, test } from "./harness.ts";

/**
 * Both tests create the same table and insert the same primary key. They can
 * only both pass if the first test's transaction was rolled back.
 */
describe("test harness transaction isolation", () => {
  test("first insert of a unique row", async ({ ctx }) => {
    await ctx.client.query("CREATE TABLE harness_probe (id int PRIMARY KEY)");
    await ctx.client.query("INSERT INTO harness_probe (id) VALUES (1)");
    const rows = await ctx.client.query<{ n: string }>("SELECT count(*) AS n FROM harness_probe");
    expect(rows.rows[0]?.n).toBe("1");
  });

  test("second insert of the same unique row", async ({ ctx }) => {
    await ctx.client.query("CREATE TABLE harness_probe (id int PRIMARY KEY)");
    await ctx.client.query("INSERT INTO harness_probe (id) VALUES (1)");
    const rows = await ctx.client.query<{ n: string }>("SELECT count(*) AS n FROM harness_probe");
    expect(rows.rows[0]?.n).toBe("1");
  });
});
