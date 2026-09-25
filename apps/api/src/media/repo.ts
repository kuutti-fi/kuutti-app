import type { Queryable } from "@kuutti/db";
import type { Photo, PhotoId, PhotoState, PhotoVariant } from "@kuutti/schema";

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
  position: r.position as number,
  createdAt: (r.created_at as Date).toISOString(),
});

const COLUMNS = "id, key, blurhash, width, height, state, position, created_at";

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
 * fewer than `maxPhotos`: the cap is the statement's HAVING clause, so two
 * uploads that both passed the service's count cannot both insert past it.
 * Null means the cap refused this one. Two concurrent inserts may still take
 * the same position (READ COMMITTED sees the same max); the order stays
 * stable through created_at and is renumbered by the next reorder or delete.
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

export async function insertPhotoAccess(
  db: Queryable,
  input: { accountId: string; photoId: string; variant: PhotoVariant; at: Date },
): Promise<void> {
  await db.query(
    "INSERT INTO photo_access (account_id, photo_id, variant, at) VALUES ($1, $2, $3, $4)",
    [input.accountId, input.photoId, input.variant, input.at],
  );
}
