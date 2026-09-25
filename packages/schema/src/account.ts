import { z } from "zod";
import { AuthPlatform } from "./identity.ts";
import { Photo, PhotoRejectionReason, PhotoVariant } from "./media.ts";

/**
 * The account's own lifecycle (#51, TD-7): deletion per the erasure table and
 * the export of what Kuutti holds about the person. Both act on the caller's
 * account only (rule 6); nothing here names another account.
 */

/** A body, so a stray call cannot erase an account; the app shows its own confirmation first. */
export const AccountDeletionRequest = z
  .object({
    confirm: z
      .literal(true)
      .meta({ description: "Must be true: the person confirmed in the app." }),
  })
  .strict()
  .meta({ id: "AccountDeletionRequest" });
export type AccountDeletionRequest = z.infer<typeof AccountDeletionRequest>;

const SignedVariantUrls = z
  .object({
    thumb: z.url(),
    card: z.url(),
    full: z.url(),
  })
  .meta({ id: "SignedVariantUrls", description: "Fifteen-minute URLs, one per variant." });

export const ExportedPhoto = Photo.extend({
  /** Absent when the API has no object storage configured (development without the stand-in). */
  urls: SignedVariantUrls.nullable(),
  review: z
    .object({
      decision: z.enum(["approved", "queued", "rejected"]),
      reason: PhotoRejectionReason.nullable(),
      decidedByStaff: z
        .boolean()
        .meta({ description: "True when a person decided, false when the automatic check did." }),
      decidedAt: z.iso.datetime().nullable(),
    })
    .nullable()
    .meta({ description: "The moderation outcome; label names are not part of it." }),
}).meta({ id: "ExportedPhoto" });
export type ExportedPhoto = z.infer<typeof ExportedPhoto>;

/**
 * Everything Kuutti holds about the person, as of now. What it does not hold
 * is as telling as what it does: no name, no date of birth beyond year and
 * month, no personal identity code (only its keyed hash, which is omitted
 * because it identifies nothing without the key).
 */
export const AccountExport = z
  .object({
    exportedAt: z.iso.datetime(),
    account: z.object({
      id: z.uuid(),
      state: z.string().min(1),
      registeredAt: z.iso.datetime(),
      birthYear: z.int().nullable(),
      birthMonth: z.int().nullable(),
    }),
    identity: z.object({
      firstSeenAt: z.iso.datetime(),
      lastBankLoginAt: z.iso.datetime().nullable(),
      /** The identification level the bank asserted (acr), a URI. */
      loginLevel: z.string().nullable(),
      deletionCount: z.int().min(0),
    }),
    sessions: z.array(
      z.object({
        sessionId: z.uuid(),
        platform: AuthPlatform,
        createdAt: z.iso.datetime(),
        lastUsedAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
      }),
    ),
    photos: z.array(ExportedPhoto).max(50),
    /** The person's own fetches of their photos (the exposure log of TD-6), newest first, at most 1000. */
    photoAccessLog: z
      .array(z.object({ photoId: z.uuid(), variant: PhotoVariant, at: z.iso.datetime() }))
      .max(1000),
  })
  .meta({ id: "AccountExport" });
export type AccountExport = z.infer<typeof AccountExport>;
