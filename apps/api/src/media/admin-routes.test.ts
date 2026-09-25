import { ErrorResponse, PhotoList, PhotoReviewQueue, PhotoUrlResponse } from "@kuutti/schema";
import { describe, expect } from "vitest";
import { createApp } from "../app.ts";
import { signedInAccount, staffSession, withMatchingConfig } from "../test/account.ts";
import { captureLogger, type TestContext, test, testConfig } from "../test/harness.ts";
import { TEST_MEDIA_BASE, testMediaDeps } from "../test/media.ts";

// The photo review queue (#49, features/media/moderation.feature): happy
// path, validation, unauthenticated, wrong role, and the audit row behind
// every view and decision. Photos are written straight into the transaction
// in the states moderation would leave them in.

async function appWith(ctx: TestContext) {
  await withMatchingConfig(ctx.client, { max_photos: 6 });
  const { logger, lines } = await captureLogger();
  const media = testMediaDeps();
  const app = createApp({ config: testConfig(), logger, db: ctx.client, media: media.deps });
  return { app, logs: lines };
}

async function photoIn(
  ctx: TestContext,
  accountId: string,
  state: "pending" | "queued" | "approved" | "rejected",
  options: { key?: string; labels?: unknown[]; flagged?: string[]; ago?: number } = {},
) {
  const created = new Date(Date.now() - (options.ago ?? 0) * 1000);
  const { rows } = await ctx.client.query<{ id: string }>(
    `INSERT INTO photo (account_id, key, blurhash, width, height, state, position, created_at)
     VALUES ($1, $2, 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', 800, 1067, $3,
             (SELECT coalesce(max(position) + 1, 0) FROM photo WHERE account_id = $1), $4) RETURNING id`,
    [accountId, options.key ?? `k-${Math.random().toString(36).slice(2)}`, state, created],
  );
  const id = rows[0]?.id ?? "";
  if (options.labels) {
    await ctx.client.query(
      `INSERT INTO photo_review (photo_id, labels, faces, flagged, checked_at, decision)
       VALUES ($1, $2::jsonb, 1, $3, now(), 'queued')`,
      [id, JSON.stringify(options.labels), options.flagged ?? []],
    );
  }
  return id;
}

const errorCode = async (res: Response) => ErrorResponse.parse(await res.json()).error.code;
const decide = (
  app: ReturnType<typeof createApp>,
  headers: Record<string, string>,
  id: string,
  body: unknown,
) =>
  app.request(`/admin/photos/${id}/decision`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("photo review queue", () => {
  test("The queue shows queued photos oldest first with what the check saw", async ({ ctx }) => {
    const { app } = await appWith(ctx);
    const staff = await staffSession(ctx.client);
    const owner = await signedInAccount(ctx.client);
    const older = await photoIn(ctx, owner.accountId, "queued", {
      ago: 600,
      labels: [{ name: "Suggestive", parentName: "", confidence: 71.5 }],
      flagged: ["Suggestive"],
    });
    const newer = await photoIn(ctx, owner.accountId, "queued", {
      ago: 60,
      labels: [],
      flagged: ["no_face"],
    });
    await photoIn(ctx, owner.accountId, "approved");

    const res = await app.request("/admin/photos/queue", { headers: staff.headers });
    expect(res.status).toBe(200);
    const queue = PhotoReviewQueue.parse(await res.json());
    expect(queue.total).toBe(2);
    expect(queue.items.map((i) => i.photoId)).toEqual([older, newer]);
    expect(queue.items[0]).toMatchObject({
      accountId: owner.accountId,
      state: "queued",
      faces: 1,
      flagged: ["Suggestive"],
      labels: [{ name: "Suggestive", parentName: "", confidence: 71.5 }],
    });
    expect(queue.items[0]?.checkedAt).toBeTruthy();
    const limited = PhotoReviewQueue.parse(
      await (await app.request("/admin/photos/queue?limit=1", { headers: staff.headers })).json(),
    );
    expect(limited.items).toHaveLength(1);
    expect(limited.total).toBe(2);
    expect(
      (await app.request("/admin/photos/queue?limit=0", { headers: staff.headers })).status,
    ).toBe(400);
    // Nothing the queue returns names hetu_hmac or research_id.
    expect(JSON.stringify(queue)).not.toMatch(/hetu|research/);
  });

  test("Staff view a card through a signed URL and every view is audited", async ({ ctx }) => {
    const { app, logs } = await appWith(ctx);
    const staff = await staffSession(ctx.client);
    const owner = await signedInAccount(ctx.client);
    const id = await photoIn(ctx, owner.accountId, "queued", { key: "abc" });
    const res = await app.request(`/admin/photos/${id}/card`, { headers: staff.headers });
    expect(res.status).toBe(200);
    const body = PhotoUrlResponse.parse(await res.json());
    expect(body.variant).toBe("card");
    expect(new URL(body.url).pathname).toBe("/media/abc/card.webp");
    const audit = await ctx.client.query(
      "SELECT actor_identity_id, action, subject_type, subject_id, detail FROM audit_log",
    );
    expect(audit.rows).toEqual([
      {
        actor_identity_id: staff.identityId,
        action: "photo.view",
        subject_type: "photo",
        subject_id: id,
        detail: { variant: "card", state: "queued" },
      },
    ]);
    // A staff view is not a fetch by the owner: no photo_access row, and the log names the staff identity.
    expect(
      Number((await ctx.client.query("SELECT count(*) AS n FROM photo_access")).rows[0]?.n),
    ).toBe(0);
    expect(logs().find((l) => l.msg === "staff photo view")).toMatchObject({
      staffIdentityId: staff.identityId,
      photoId: id,
    });
    expect(
      (
        await app.request("/admin/photos/6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b/card", {
          headers: staff.headers,
        })
      ).status,
    ).toBe(404);
    expect((await app.request("/admin/photos/nope/card", { headers: staff.headers })).status).toBe(
      400,
    );
  });

  test("A moderator approves a queued photo", async ({ ctx }) => {
    const { app } = await appWith(ctx);
    const staff = await staffSession(ctx.client);
    const owner = await signedInAccount(ctx.client);
    const id = await photoIn(ctx, owner.accountId, "queued", { labels: [], flagged: ["no_face"] });
    const res = await decide(app, staff.headers, id, { decision: "approve" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ photoId: id, state: "approved", rejectionReason: null });
    const review = await ctx.client.query(
      "SELECT decision, decided_by, decided_at, reason, flagged FROM photo_review WHERE photo_id = $1",
      [id],
    );
    expect(review.rows[0]).toMatchObject({
      decision: "approved",
      decided_by: staff.identityId,
      reason: null,
      flagged: ["no_face"],
    });
    expect(review.rows[0]?.decided_at).toBeInstanceOf(Date);
    const audit = await ctx.client.query("SELECT action, detail FROM audit_log ORDER BY at");
    expect(audit.rows).toEqual([
      { action: "photo.approve", detail: { from: "queued", to: "approved", reason: null } },
    ]);
  });

  test("A moderator rejects a queued photo with a reason and the owner is told", async ({
    ctx,
  }) => {
    const { app } = await appWith(ctx);
    const staff = await staffSession(ctx.client);
    const owner = await signedInAccount(ctx.client);
    const id = await photoIn(ctx, owner.accountId, "queued");
    const res = await decide(app, staff.headers, id, { decision: "reject", reason: "no_person" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      photoId: id,
      state: "rejected",
      rejectionReason: "no_person",
    });
    // The list of the owner carries the reason; the owner can still fetch their own rejected photo.
    const list = PhotoList.parse(
      await (await app.request("/photos", { headers: owner.headers })).json(),
    );
    expect(list.photos[0]).toMatchObject({ id, state: "rejected", rejectionReason: "no_person" });
    expect((await app.request(`/photos/${id}/thumb`, { headers: owner.headers })).status).toBe(200);
    const audit = await ctx.client.query("SELECT action, detail FROM audit_log");
    expect(audit.rows).toEqual([
      { action: "photo.reject", detail: { from: "queued", to: "rejected", reason: "no_person" } },
    ]);
    // No label name in any log line was ever a risk here; the reason is a code, and the owner sees a text.
  });

  test("A decision is taken once, on a queued photo only, and a refused one leaves no audit row", async ({
    ctx,
  }) => {
    const { app } = await appWith(ctx);
    const staff = await staffSession(ctx.client);
    const owner = await signedInAccount(ctx.client);
    const queued = await photoIn(ctx, owner.accountId, "queued", { labels: [] });
    const pending = await photoIn(ctx, owner.accountId, "pending");
    const rejected = await photoIn(ctx, owner.accountId, "rejected");
    expect((await decide(app, staff.headers, queued, { decision: "approve" })).status).toBe(200);
    // The same photo again, a photo the check has not finished, and an earlier rejection.
    for (const id of [queued, pending, rejected]) {
      const res = await decide(app, staff.headers, id, { decision: "approve" });
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("photo_not_queued");
    }
    const states = await ctx.client.query<{ id: string; state: string }>(
      "SELECT id, state FROM photo WHERE id = ANY($1::uuid[])",
      [[queued, pending, rejected]],
    );
    expect(Object.fromEntries(states.rows.map((r) => [r.id, r.state]))).toEqual({
      [queued]: "approved",
      [pending]: "pending",
      [rejected]: "rejected",
    });
    const audit = await ctx.client.query("SELECT action FROM audit_log");
    expect(audit.rows).toEqual([{ action: "photo.approve" }]);
  });

  test("A rejection needs a reason from the list", async ({ ctx }) => {
    const { app } = await appWith(ctx);
    const staff = await staffSession(ctx.client);
    const owner = await signedInAccount(ctx.client);
    const id = await photoIn(ctx, owner.accountId, "queued");
    expect((await decide(app, staff.headers, id, { decision: "reject" })).status).toBe(400);
    expect(
      (await decide(app, staff.headers, id, { decision: "reject", reason: "ugly" })).status,
    ).toBe(400);
    expect((await decide(app, staff.headers, id, { decision: "maybe" })).status).toBe(400);
    expect(
      (await decide(app, staff.headers, id, { decision: "approve", reason: "nudity" })).status,
    ).toBe(400);
    const state = await ctx.client.query("SELECT state FROM photo WHERE id = $1", [id]);
    expect(state.rows[0]?.state).toBe("queued");
    expect(Number((await ctx.client.query("SELECT count(*) AS n FROM audit_log")).rows[0]?.n)).toBe(
      0,
    );
  });

  test("A researcher may not touch the photo queue", async ({ ctx }) => {
    const { app } = await appWith(ctx);
    const researcher = await staffSession(ctx.client, "researcher");
    const owner = await signedInAccount(ctx.client);
    const id = await photoIn(ctx, owner.accountId, "queued");
    for (const res of [
      await app.request("/admin/photos/queue", { headers: researcher.headers }),
      await app.request(`/admin/photos/${id}/card`, { headers: researcher.headers }),
      await decide(app, researcher.headers, id, { decision: "approve" }),
    ]) {
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("admin_forbidden");
    }
    expect(Number((await ctx.client.query("SELECT count(*) AS n FROM audit_log")).rows[0]?.n)).toBe(
      0,
    );
    expect(
      (await ctx.client.query("SELECT state FROM photo WHERE id = $1", [id])).rows[0]?.state,
    ).toBe("queued");
    // whoami answers every role.
    const me = await app.request("/admin/whoami", { headers: researcher.headers });
    expect(me.status).toBe(200);
    expect((await me.json()).role).toBe("researcher");
  });

  test("The photo routes for staff refuse a product session and no session", async ({ ctx }) => {
    const { app } = await appWith(ctx);
    const owner = await signedInAccount(ctx.client);
    const id = await photoIn(ctx, owner.accountId, "queued");
    for (const headers of [owner.headers, {}]) {
      for (const res of [
        await app.request("/admin/photos/queue", { headers }),
        await app.request(`/admin/photos/${id}/card`, { headers }),
        await decide(app, headers, id, { decision: "approve" }),
      ]) {
        expect(res.status).toBe(401);
        expect(await errorCode(res)).toBe("unauthenticated");
      }
    }
    expect(Number((await ctx.client.query("SELECT count(*) AS n FROM audit_log")).rows[0]?.n)).toBe(
      0,
    );
    void TEST_MEDIA_BASE;
  });
});
