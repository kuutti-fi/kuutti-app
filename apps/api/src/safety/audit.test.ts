import { describe, expect } from "vitest";
import { signedInAccount, staffSession } from "../test/account.ts";
import { test } from "../test/harness.ts";
import { recordAudit } from "./audit.ts";

// features/safety/audit.feature: the row says who, what, subject, when; and
// the trigger of migration 0006 keeps it that way against the application role,
// which is the role these tests run as.

describe("audit log", () => {
  test("An audit row is written with who, what, subject and when", async ({ ctx }) => {
    const staff = await staffSession(ctx.client);
    const owner = await signedInAccount(ctx.client);
    const photo = await ctx.client.query<{ id: string }>(
      `INSERT INTO photo (account_id, key, blurhash, width, height, position)
       VALUES ($1, 'k', 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', 10, 10, 0) RETURNING id`,
      [owner.accountId],
    );
    const photoId = photo.rows[0]?.id ?? "";
    const id = await recordAudit(ctx.client, {
      actorIdentityId: staff.identityId,
      action: "photo.view",
      subjectType: "photo",
      subjectId: photoId,
      detail: { variant: "card" },
    });
    const row = await ctx.client.query(
      "SELECT actor_identity_id, action, subject_type, subject_id, detail, at FROM audit_log WHERE id = $1",
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      actor_identity_id: staff.identityId,
      action: "photo.view",
      subject_type: "photo",
      subject_id: photoId,
      detail: { variant: "card" },
    });
    expect(row.rows[0]?.at).toBeInstanceOf(Date);
  });

  test("An audit row cannot be updated or deleted", async ({ ctx }) => {
    const staff = await staffSession(ctx.client);
    const id = await recordAudit(ctx.client, {
      actorIdentityId: staff.identityId,
      action: "photo.approve",
      subjectType: "photo",
      subjectId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    });
    // A failed statement aborts the surrounding transaction in Postgres, so
    // each attempt runs inside its own savepoint and the transaction of the test survives.
    await ctx.client.query("SAVEPOINT attempt");
    await expect(
      ctx.client.query("UPDATE audit_log SET action = 'photo.reject' WHERE id = $1", [id]),
    ).rejects.toThrow(/append-only: UPDATE refused/);
    await ctx.client.query("ROLLBACK TO SAVEPOINT attempt");
    await expect(ctx.client.query("DELETE FROM audit_log WHERE id = $1", [id])).rejects.toThrow(
      /append-only: DELETE refused/,
    );
    await ctx.client.query("ROLLBACK TO SAVEPOINT attempt");
    await expect(ctx.client.query("TRUNCATE audit_log")).rejects.toThrow(
      /append-only: TRUNCATE refused/,
    );
    await ctx.client.query("ROLLBACK TO SAVEPOINT attempt");
    const row = await ctx.client.query("SELECT action FROM audit_log WHERE id = $1", [id]);
    expect(row.rows[0]?.action).toBe("photo.approve");
  });
});
