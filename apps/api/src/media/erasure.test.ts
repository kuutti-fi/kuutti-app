import { describe, expect } from "vitest";
import { signedInAccount, withMatchingConfig } from "../test/account.ts";
import { test } from "../test/harness.ts";
import { insertPhoto, insertPhotoAccess } from "./repo.ts";

// The media half of erasure (#51): an upload or a fetch that passed the guard
// before the account was erased reaches its insert after the commit, and the
// statement refuses the tombstone by itself.

describe("media inserts after erasure", () => {
  test("the photo and fetch-log inserts refuse an erased account", async ({ ctx }) => {
    await withMatchingConfig(ctx.client, { max_photos: 6 });
    const a = await signedInAccount(ctx.client);
    await ctx.client.query(
      "UPDATE account SET state = 'deleted', deleted_at = now() WHERE id = $1",
      [a.accountId],
    );
    expect(
      await insertPhoto(ctx.client, {
        accountId: a.accountId,
        key: "k-late",
        blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        width: 1,
        height: 1,
        maxPhotos: 6,
      }),
    ).toBeNull();
    expect(
      await insertPhotoAccess(ctx.client, {
        accountId: a.accountId,
        photoId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
        variant: "thumb",
        at: new Date(),
      }),
    ).toBe(false);
    for (const table of ["photo", "photo_access"]) {
      const { rows } = await ctx.client.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${table} WHERE account_id = $1`,
        [a.accountId],
      );
      expect(Number(rows[0]?.n), table).toBe(0);
    }
  });
});
