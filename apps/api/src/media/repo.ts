import type { Queryable } from "@kuutti/db";
import type {
  ModerationLabel,
  Photo,
  PhotoId,
  PhotoRejectionReason,
  PhotoReviewItem,
  PhotoState,
  PhotoVariant,
} from "@kuutti/schema";

// Raw parameterised SQL for the same reason as identity/repo.ts: Deps.db is
// the Queryable seam the test harness hands a rolled-back transaction through.
// Every statement that reads or changes a photo carries the caller's account
// id in its WHERE clause (rule 6); the one exception, countRowsForKey, counts
// rows for an object key across accounts because the object is shared.

type Row = Record<string, unknown>;

export type PhotoRow = Photo & { key: string };

const photoFrom = (r: Row): PhotoRow => ({
  id: r.id as PhotoId,
  key: r.key as string,
  blurhash: r.blurhash as string,
  width: r.width as number,
  height: r.height as number,
  state: r.state as PhotoState,
  rejectionReason: (r.rejection_reason as PhotoRejectionReason | null) ?? null,
  position: r.position as number,
  createdAt: (r.created_at as Date).toISOString(),
});

const COLUMNS = "id, key, blurhash, width, height, state, rejection_reason, position, created_at";

export async function listPhotos(db: Queryable, accountId: string): Promise<PhotoRow[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM photo WHERE account_id = $1 ORDER BY position, created_at`,
    [accountId],
  );
  return rows.map(photoFrom);
}

export async function countPhotos(db: Queryable, accountId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM photo WHERE account_id = $1",
    [accountId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Appends after the account's last photo, and only while the account has
 * fewer than `maxPhotos` and is still live: both are the statement's HAVING
 * clause, so a request that arrives after another's commit (an upload that
 * outlived the erasure of its account, #51) is refused here even when it
 * passed the guard and the service's count. Null means the statement refused. Two
 * inserts that run at the same instant can still both see the old count
 * under READ COMMITTED and both succeed, one photo over the cap and on the
 * same position; the order stays stable through created_at and is renumbered
 * by the next reorder or delete, and the extra photo is the account's own to
 * remove. Closing that window needs a transaction with an advisory lock per
 * account, which the query seam does not offer yet; it is a product cap, not a
 * security boundary, so that waits for the seam.
 */
export async function insertPhoto(
  db: Queryable,
  input: {
    accountId: string;
    key: string;
    blurhash: string;
    width: number;
    height: number;
    maxPhotos: number;
  },
): Promise<PhotoRow | null> {
  const { rows } = await db.query<Row>(
    `INSERT INTO photo (account_id, key, blurhash, width, height, position)
     SELECT $1, $2, $3, $4, $5, coalesce(max(position) + 1, 0) FROM photo WHERE account_id = $1
     HAVING count(*) < $6
        AND EXISTS (SELECT 1 FROM account WHERE id = $1 AND state <> 'deleted')
     RETURNING ${COLUMNS}`,
    [input.accountId, input.key, input.blurhash, input.width, input.height, input.maxPhotos],
  );
  return rows[0] ? photoFrom(rows[0]) : null;
}

export async function findPhoto(
  db: Queryable,
  accountId: string,
  photoId: string,
): Promise<PhotoRow | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM photo WHERE id = $1 AND account_id = $2`,
    [photoId, accountId],
  );
  return rows[0] ? photoFrom(rows[0]) : null;
}

/** The deleted row, or null when it was not the caller's. */
export async function deletePhoto(
  db: Queryable,
  accountId: string,
  photoId: string,
): Promise<PhotoRow | null> {
  const { rows } = await db.query<Row>(
    `DELETE FROM photo WHERE id = $1 AND account_id = $2 RETURNING ${COLUMNS}`,
    [photoId, accountId],
  );
  return rows[0] ? photoFrom(rows[0]) : null;
}

/** Rows of any account under this content key: the objects go only when this reaches zero. */
export async function countRowsForKey(db: Queryable, key: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM photo WHERE key = $1", [
    key,
  ]);
  return Number(rows[0]?.n ?? 0);
}

/** Renumbers the account's photos 0..n-1 in the given order; ids not the caller's change nothing. */
export async function setPositions(
  db: Queryable,
  accountId: string,
  order: string[],
): Promise<void> {
  await db.query(
    `UPDATE photo SET position = o.position
     FROM (SELECT id::uuid, (ordinality - 1)::smallint AS position
           FROM unnest($2::text[]) WITH ORDINALITY AS u(id, ordinality)) AS o
     WHERE photo.id = o.id AND photo.account_id = $1`,
    [accountId, order],
  );
}

/** Closes the gap a deletion left, so positions stay 0..n-1. */
export async function compactPositions(db: Queryable, accountId: string): Promise<void> {
  await db.query(
    `UPDATE photo SET position = o.position
     FROM (SELECT id, (row_number() OVER (ORDER BY position, created_at) - 1)::smallint AS position
           FROM photo WHERE account_id = $1) AS o
     WHERE photo.id = o.id AND photo.account_id = $1`,
    [accountId],
  );
}

/** False when the account is no longer live: a fetch that outlived the erasure writes nothing (#51). */
export async function insertPhotoAccess(
  db: Queryable,
  input: { accountId: string; photoId: string; variant: PhotoVariant; at: Date },
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO photo_access (account_id, photo_id, variant, at)
     SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM account WHERE id = $1 AND state <> 'deleted')`,
    [input.accountId, input.photoId, input.variant, input.at],
  );
  return result.rowCount === 1;
}

// Moderation (#49). The automatic check and the staff routes read photos
// across accounts on purpose: what a moderator sees is every queued photo,
// behind the admin guard (lib/admin-middleware.ts) and an audit row per view.
// Rule 6 scopes what a person reads about themselves; staff access is the
// exception the security checklist names, and it is logged.

/** The automatic check's result; never overwrites a person's decision. */
export async function upsertAutomaticReview(
  db: Queryable,
  input: {
    photoId: string;
    labels: ModerationLabel[];
    faces: number;
    flagged: string[];
    modelVersion: string | null;
    checkedAt: Date;
    decision: "approved" | "queued";
  },
): Promise<void> {
  await db.query(
    `INSERT INTO photo_review (photo_id, labels, faces, flagged, model_version, checked_at, decision)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)
     ON CONFLICT (photo_id) DO UPDATE
       SET labels = EXCLUDED.labels, faces = EXCLUDED.faces, flagged = EXCLUDED.flagged,
           model_version = EXCLUDED.model_version, checked_at = EXCLUDED.checked_at,
           decision = EXCLUDED.decision
       WHERE photo_review.decided_by IS NULL`,
    [
      input.photoId,
      JSON.stringify(input.labels),
      input.faces,
      input.flagged,
      input.modelVersion,
      input.checkedAt,
      input.decision,
    ],
  );
}

/** pending → approved or queued; true when this call moved it (a person's decision stands). */
export async function movePendingPhoto(
  db: Queryable,
  photoId: string,
  decision: "approved" | "queued",
): Promise<boolean> {
  const result = await db.query("UPDATE photo SET state = $2 WHERE id = $1 AND state = 'pending'", [
    photoId,
    decision,
  ]);
  return result.rowCount === 1;
}

/**
 * Photos still pending with no person's decision, oldest first: what the
 * nightly sweep retries. That is a photo the check never reached, and one the
 * check recorded but whose state did not move (the two writes are one
 * transaction now; rows from before that are picked up here too).
 */
export async function findPendingUnchecked(
  db: Queryable,
  olderThan: Date,
  limit: number,
): Promise<Array<{ id: string; accountId: string; key: string }>> {
  const { rows } = await db.query<Row>(
    `SELECT p.id, p.account_id, p.key FROM photo p
     LEFT JOIN photo_review r ON r.photo_id = p.id
     WHERE p.state = 'pending' AND (r.photo_id IS NULL OR r.decided_by IS NULL) AND p.created_at < $1
     ORDER BY p.created_at LIMIT $2`,
    [olderThan, limit],
  );
  return rows.map((r) => ({
    id: r.id as string,
    accountId: r.account_id as string,
    key: r.key as string,
  }));
}

const reviewItemFrom = (r: Row): PhotoReviewItem => ({
  photoId: r.id as PhotoId,
  accountId: r.account_id as string,
  state: r.state as PhotoState,
  blurhash: r.blurhash as string,
  width: r.width as number,
  height: r.height as number,
  uploadedAt: (r.created_at as Date).toISOString(),
  checkedAt: ((r.checked_at as Date | null) ?? null)?.toISOString() ?? null,
  labels: (r.labels as ModerationLabel[] | null) ?? [],
  faces: (r.faces as number | null) ?? 0,
  flagged: (r.flagged as string[] | null) ?? [],
});

const QUEUE_COLUMNS = `p.id, p.account_id, p.state, p.blurhash, p.width, p.height, p.created_at,
  r.checked_at, r.labels, r.faces, r.flagged`;

/** The human queue: queued photos, oldest first. */
export async function listQueue(db: Queryable, limit: number): Promise<PhotoReviewItem[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${QUEUE_COLUMNS} FROM photo p LEFT JOIN photo_review r ON r.photo_id = p.id
     WHERE p.state = 'queued' ORDER BY p.created_at LIMIT $1`,
    [limit],
  );
  return rows.map(reviewItemFrom);
}

export async function countQueue(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM photo WHERE state = 'queued'",
  );
  return Number(rows[0]?.n ?? 0);
}

/** One photo as staff sees it, any account; null when there is no such photo. */
export async function findPhotoForStaff(
  db: Queryable,
  photoId: string,
): Promise<(PhotoRow & { accountId: string }) | null> {
  const { rows } = await db.query<Row>(`SELECT ${COLUMNS}, account_id FROM photo WHERE id = $1`, [
    photoId,
  ]);
  const r = rows[0];
  return r ? { ...photoFrom(r), accountId: r.account_id as string } : null;
}

/**
 * A person's decision: the photo's state and reason, and the review row with
 * who decided and when. Only a queued photo takes one (null otherwise, and
 * nothing is written), so an earlier decision is never overwritten. Rejected
 * is only ever written here (rules/api.md: never auto-delete, never auto-reject).
 */
export async function decidePhoto(
  db: Queryable,
  input: {
    photoId: string;
    decision: "approved" | "rejected";
    reason: PhotoRejectionReason | null;
    decidedBy: string;
    at: Date;
  },
): Promise<PhotoRow | null> {
  const { rows } = await db.query<Row>(
    `UPDATE photo SET state = $2, rejection_reason = $3 WHERE id = $1 AND state = 'queued' RETURNING ${COLUMNS}`,
    [input.photoId, input.decision, input.reason],
  );
  const row = rows[0];
  if (!row) return null;
  await db.query(
    `INSERT INTO photo_review (photo_id, labels, faces, flagged, decision, decided_by, decided_at, reason)
     VALUES ($1, '[]'::jsonb, 0, '{}', $2, $3, $4, $5)
     ON CONFLICT (photo_id) DO UPDATE
       SET decision = EXCLUDED.decision, decided_by = EXCLUDED.decided_by,
           decided_at = EXCLUDED.decided_at, reason = EXCLUDED.reason`,
    [input.photoId, input.decision, input.decidedBy, input.at, input.reason],
  );
  return photoFrom(row);
}

// Erasure and export (#51, TD-7): the account's photos, their review rows
// (cascade) and its own fetch log go; the objects go when no other row shares
// the content, decided by the caller after the transaction.

/** Deletes every photo row of the account; returns their content keys. */
export async function deletePhotosOfAccount(db: Queryable, accountId: string): Promise<string[]> {
  const { rows } = await db.query<{ key: string }>(
    "DELETE FROM photo WHERE account_id = $1 RETURNING key",
    [accountId],
  );
  return rows.map((r) => r.key);
}

export async function deletePhotoAccessOfAccount(
  db: Queryable,
  accountId: string,
): Promise<number> {
  const result = await db.query("DELETE FROM photo_access WHERE account_id = $1", [accountId]);
  return result.rowCount ?? 0;
}

/** Of the given keys, those no photo row references any more. */
export async function orphanedKeys(db: Queryable, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const { rows } = await db.query<{ key: string }>(
    `SELECT k.key FROM unnest($1::text[]) AS k(key)
     WHERE NOT EXISTS (SELECT 1 FROM photo p WHERE p.key = k.key)`,
    [[...new Set(keys)]],
  );
  return rows.map((r) => r.key);
}

export async function listPhotoAccessOfAccount(
  db: Queryable,
  accountId: string,
  limit: number,
): Promise<Array<{ photoId: string; variant: PhotoVariant; at: Date }>> {
  const { rows } = await db.query<Row>(
    "SELECT photo_id, variant, at FROM photo_access WHERE account_id = $1 ORDER BY at DESC LIMIT $2",
    [accountId, limit],
  );
  return rows.map((r) => ({
    photoId: r.photo_id as string,
    variant: r.variant as PhotoVariant,
    at: r.at as Date,
  }));
}

/** The moderation outcome per photo of the account, for the export; never the labels. */
export async function listReviewsForAccount(
  db: Queryable,
  accountId: string,
): Promise<
  Map<
    string,
    {
      decision: "approved" | "queued" | "rejected";
      reason: PhotoRejectionReason | null;
      decidedBy: string | null;
      decidedAt: Date | null;
    }
  >
> {
  const { rows } = await db.query<Row>(
    `SELECT r.photo_id, r.decision, r.reason, r.decided_by, r.decided_at
     FROM photo_review r JOIN photo p ON p.id = r.photo_id WHERE p.account_id = $1`,
    [accountId],
  );
  return new Map(
    rows.map((r) => [
      r.photo_id as string,
      {
        decision: r.decision as "approved" | "queued" | "rejected",
        reason: (r.reason as PhotoRejectionReason | null) ?? null,
        decidedBy: (r.decided_by as string | null) ?? null,
        decidedAt: (r.decided_at as Date | null) ?? null,
      },
    ]),
  );
}
