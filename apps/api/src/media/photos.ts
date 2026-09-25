import type { Queryable } from "@kuutti/db";
import {
  PHOTO_VARIANTS,
  type Photo,
  type PhotoList,
  type PhotoUrlResponse,
  type PhotoVariant,
} from "@kuutti/schema";
import type { LimitFunction } from "p-limit";
import { AppError } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";
import { matchingConfigNumber } from "../lib/matching-config.ts";
import { PipelineError, processPhoto } from "./pipeline.ts";
import * as repo from "./repo.ts";
import { type MediaStore, objectKey, WEBP } from "./store.ts";
import { URL_TTL_MS, type UrlSigner } from "./urls.ts";

/** What the photo routes need beyond the database: injected, so tests hand in a memory store and a test key. */
export type MediaDeps = {
  store: MediaStore;
  signer: UrlSigner;
  /** p-limit at the vCPU count (rules/api.md Media); above it the upload answers 503. */
  limit: LimitFunction;
};

export type PhotoServiceDeps = MediaDeps & { db: Queryable; logger: Logger; now: () => Date };

export const RETRY_AFTER_SECONDS = 5;
export const MAX_PHOTOS_KEY = "max_photos";

const toPhoto = ({ key: _key, ...photo }: repo.PhotoRow): Photo => photo;

export async function listPhotos(deps: PhotoServiceDeps, accountId: string): Promise<PhotoList> {
  const [rows, maxPhotos] = await Promise.all([
    repo.listPhotos(deps.db, accountId),
    matchingConfigNumber(deps.db, MAX_PHOTOS_KEY),
  ]);
  return { photos: rows.map(toPhoto), maxPhotos };
}

/**
 * One upload: count against max_photos, run the pipeline under the
 * concurrency limit, store the three variants, insert the row. The input
 * bytes are referenced by nothing after processPhoto returns; the store only
 * ever receives variants (rule 4).
 */
export async function uploadPhoto(
  deps: PhotoServiceDeps,
  input: { accountId: string; bytes: Uint8Array },
): Promise<Photo> {
  const maxPhotos = await matchingConfigNumber(deps.db, MAX_PHOTOS_KEY);
  // The cheap refusal before any pixel is touched; the insert below applies
  // the same cap again in its own statement, which is the one that holds.
  if ((await repo.countPhotos(deps.db, input.accountId)) >= maxPhotos) {
    throw new AppError(409, "photo_limit", "The account has its maximum number of photos", {
      maxPhotos,
    });
  }
  // Fail closed above the limit rather than queue: a queue is unbounded work
  // on one box (security checklist, "Mishandling of exceptional conditions").
  // p-limit counts a call as pending until it starts, so both counts matter.
  if (deps.limit.activeCount + deps.limit.pendingCount >= deps.limit.concurrency) {
    throw new AppError(503, "media_busy", "Image processing is at capacity", {
      active: deps.limit.activeCount,
    });
  }
  let processed: Awaited<ReturnType<typeof processPhoto>>;
  try {
    processed = await deps.limit(() => processPhoto(input.bytes));
  } catch (error) {
    if (error instanceof PipelineError) {
      const status = error.reason === "unsupported" ? 415 : 422;
      const code = error.reason === "unsupported" ? "photo_unsupported" : "photo_invalid";
      throw new AppError(
        status,
        error.reason === "too_many_pixels" ? "photo_too_many_pixels" : code,
        error.message,
      );
    }
    throw error;
  }
  await Promise.all(
    PHOTO_VARIANTS.map((variant) =>
      deps.store.put(objectKey(processed.key, variant), processed.variants[variant], WEBP),
    ),
  );
  const row = await repo.insertPhoto(deps.db, {
    accountId: input.accountId,
    key: processed.key,
    blurhash: processed.blurhash,
    width: processed.width,
    height: processed.height,
    maxPhotos,
  });
  if (!row) {
    // Two uploads raced past the count above; this one lost. Its objects go
    // unless another row already shares them.
    if ((await repo.countRowsForKey(deps.db, processed.key)) === 0) {
      await deps.store.delete(PHOTO_VARIANTS.map((v) => objectKey(processed.key, v)));
    }
    throw new AppError(409, "photo_limit", "The account has its maximum number of photos", {
      maxPhotos,
    });
  }
  deps.logger.info(
    { accountId: input.accountId, photoId: row.id, width: row.width, height: row.height },
    "photo stored",
  );
  return toPhoto(row);
}

/** Removes the row; the objects too, when no other row shares the content. */
export async function deletePhoto(
  deps: PhotoServiceDeps,
  accountId: string,
  photoId: string,
): Promise<void> {
  const row = await repo.deletePhoto(deps.db, accountId, photoId);
  if (!row) throw new AppError(404, "not_found", "No such photo of this account");
  await repo.compactPositions(deps.db, accountId);
  if ((await repo.countRowsForKey(deps.db, row.key)) === 0) {
    await deps.store.delete(PHOTO_VARIANTS.map((variant) => objectKey(row.key, variant)));
  }
  deps.logger.info({ accountId, photoId }, "photo deleted");
}

/** The order must name every photo of the account exactly once. */
export async function reorderPhotos(
  deps: PhotoServiceDeps,
  accountId: string,
  order: readonly string[],
): Promise<PhotoList> {
  const current = await repo.listPhotos(deps.db, accountId);
  const have = new Set(current.map((p) => p.id as string));
  const asked = new Set(order);
  const complete =
    asked.size === order.length && asked.size === have.size && order.every((id) => have.has(id));
  if (!complete) {
    throw new AppError(400, "photo_order_invalid", "The order does not name every photo once", {
      have: have.size,
      asked: order.length,
    });
  }
  await repo.setPositions(deps.db, accountId, [...order]);
  return listPhotos(deps, accountId);
}

/**
 * A signed URL for one variant of the caller's own photo. Visibility is the
 * query's WHERE clause (rule 6). Other people's photos arrive with the profile
 * card (#47) and the shown-record rule of the exposure budget (#52); until
 * then nothing but one's own is served. Every issuance is a photo_access row
 * and a log line with account, photo, variant and time.
 */
export async function issuePhotoUrl(
  deps: PhotoServiceDeps,
  input: { accountId: string; photoId: string; variant: PhotoVariant },
): Promise<PhotoUrlResponse> {
  const row = await repo.findPhoto(deps.db, input.accountId, input.photoId);
  if (!row) throw new AppError(404, "not_found", "No such photo of this account");
  const at = deps.now();
  const expiresAt = new Date(at.getTime() + URL_TTL_MS);
  await repo.insertPhotoAccess(deps.db, {
    accountId: input.accountId,
    photoId: input.photoId,
    variant: input.variant,
    at,
  });
  const url = await deps.signer.sign(objectKey(row.key, input.variant), expiresAt);
  deps.logger.info(
    { accountId: input.accountId, photoId: input.photoId, variant: input.variant, at },
    "photo url issued",
  );
  return { url, variant: input.variant, expiresAt: expiresAt.toISOString() };
}
