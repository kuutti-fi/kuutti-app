import type { Queryable } from "@kuutti/db";
import { type ExportedPhoto, PHOTO_VARIANTS } from "@kuutti/schema";
import type { Logger } from "../lib/logger.ts";
import { issuePhotoUrl, type PhotoServiceDeps, toPhoto } from "./photos.ts";
import * as repo from "./repo.ts";
import { type MediaStore, objectKey } from "./store.ts";

// The media slice's half of erasure and export (#51, TD-7), called by the
// identity slice through index.ts. Rows go inside the caller's transaction;
// objects go after it, because an object store has no rollback.

export type PhotoErasure = {
  photos: number;
  accessRows: number;
  /** Content keys of the deleted rows; which of their objects still have an owner is decided after the commit. */
  keys: string[];
};

export async function erasePhotosOfAccount(
  tx: Queryable,
  accountId: string,
): Promise<PhotoErasure> {
  const keys = await repo.deletePhotosOfAccount(tx, accountId);
  const accessRows = await repo.deletePhotoAccessOfAccount(tx, accountId);
  return { photos: keys.length, accessRows, keys };
}

/**
 * After the commit: the objects of the content keys no row references any
 * more. The ownership check runs here, against committed rows, not inside the
 * transaction, so an upload of the same content that committed meanwhile
 * keeps its objects. What remains is the window between this check and the
 * delete, the same one the upload's failure path and deletePhoto have had
 * since #57: closing it takes a per-content-key ownership protocol in the
 * media slice, noted for the M4 orphan sweep. Best effort: a failure is
 * logged with the content keys (SHA-256 of the WebP bytes, nothing personal)
 * and the account; the rows are already gone.
 */
export async function deleteOrphanedObjects(
  deps: { db: Queryable; store: MediaStore; logger: Logger },
  keys: string[],
  context: { accountId: string },
): Promise<number> {
  if (keys.length === 0) return 0;
  let objectKeys: string[] = [];
  try {
    const orphaned = await repo.orphanedKeys(deps.db, keys);
    objectKeys = orphaned.flatMap((key) =>
      PHOTO_VARIANTS.map((variant) => objectKey(key, variant)),
    );
    if (objectKeys.length === 0) return 0;
    await deps.store.delete(objectKeys);
    return objectKeys.length;
  } catch (error) {
    deps.logger.error(
      { err: error, accountId: context.accountId, keys, objects: objectKeys.length },
      "erasure: deleting photo objects failed",
    );
    return 0;
  }
}

export const EXPORT_ACCESS_LOG_LIMIT = 1000;

/**
 * The person's photos for the export: what the list shows, the moderation
 * outcome (never the labels), and fifteen-minute URLs for the variants, each
 * issued through the same path as any other fetch, so the export itself
 * appears in the fetch log it returns.
 */
export async function exportPhotos(
  deps:
    | PhotoServiceDeps
    | (Omit<PhotoServiceDeps, "store" | "signer" | "limit" | "moderator"> & { media?: undefined }),
  accountId: string,
): Promise<{
  photos: ExportedPhoto[];
  accessLog: Array<{ photoId: string; variant: (typeof PHOTO_VARIANTS)[number]; at: string }>;
}> {
  const rows = await repo.listPhotos(deps.db, accountId);
  const reviews = await repo.listReviewsForAccount(deps.db, accountId);
  const withStore = "signer" in deps ? (deps as PhotoServiceDeps) : null;
  const photos: ExportedPhoto[] = [];
  for (const row of rows) {
    let urls: ExportedPhoto["urls"] = null;
    if (withStore) {
      const [thumb, card, full] = await Promise.all(
        PHOTO_VARIANTS.map((variant) =>
          issuePhotoUrl(withStore, { accountId, photoId: row.id, variant }).then((r) => r.url),
        ),
      );
      if (thumb && card && full) urls = { thumb, card, full };
    }
    const review = reviews.get(row.id);
    photos.push({
      ...toPhoto(row),
      urls,
      review: review
        ? {
            decision: review.decision,
            reason: review.reason,
            decidedByStaff: review.decidedBy !== null,
            decidedAt: review.decidedAt?.toISOString() ?? null,
          }
        : null,
    });
  }
  const accessLog = (
    await repo.listPhotoAccessOfAccount(deps.db, accountId, EXPORT_ACCESS_LOG_LIMIT)
  ).map((entry) => ({
    photoId: entry.photoId,
    variant: entry.variant,
    at: entry.at.toISOString(),
  }));
  return { photos, accessLog };
}
