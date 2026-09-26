import type { Queryable } from "@kuutti/db";
import {
  type ProfileDocument,
  type ProfileResponse,
  type ProfileUpdate,
  SPECIAL_CATEGORY_FIELDS,
} from "@kuutti/schema";
import { AppError } from "../lib/errors.ts";
import { listApprovedPhotos } from "../media/index.ts";
import { type CardDeps, completenessOf } from "./card.ts";
import * as repo from "./repo.ts";
import { contactDetailsIn } from "./text.ts";

/**
 * Which fields of the update need the explicit consent, given a registry of
 * special-category fields (#47, ADR-009): a value for one of them without the
 * consent version is refused before anything is written. Pure, so the gate is
 * tested with a registry that has such a field while the real one has none.
 */
export function consentMissingFor(
  update: Pick<ProfileUpdate, "fields" | "specialCategoryConsent">,
  specialFields: readonly string[] = SPECIAL_CATEGORY_FIELDS,
): string[] {
  if (update.specialCategoryConsent) return [];
  return specialFields.filter(
    (key) => (update.fields as Record<string, unknown>)[key] !== undefined,
  );
}

/** The first field whose text carries a way to reach the person, or null. */
export function contactDetailsInUpdate(
  update: ProfileUpdate,
): { field: string; kind: string } | null {
  const texts: [string, string | null | undefined][] = [
    ["displayName", update.displayName],
    ["bio", update.bio],
    ["fields.campus", update.fields.campus],
    ...update.prompts.map((p, i): [string, string] => [`prompts.${i}.answer`, p.answer]),
  ];
  for (const [field, text] of texts) {
    if (!text) continue;
    const kind = contactDetailsIn(text);
    if (kind) return { field, kind };
  }
  return null;
}

const toDocument = ({ accountId: _accountId, ...document }: repo.ProfileRow): ProfileDocument =>
  document;

export async function readProfile(deps: CardDeps, accountId: string): Promise<ProfileResponse> {
  const [row, photos] = await Promise.all([
    repo.findProfile(deps.db, accountId),
    listApprovedPhotos(deps.db, accountId),
  ]);
  return {
    profile: row ? toDocument(row) : null,
    completeness: await completenessOf(deps, accountId, row, photos.length),
  };
}

export async function saveProfile(
  deps: CardDeps,
  accountId: string,
  update: ProfileUpdate,
): Promise<ProfileResponse> {
  const contact = contactDetailsInUpdate(update);
  if (contact) {
    throw new AppError(
      400,
      "text_contact_details",
      "Contact details are not for the card",
      contact,
    );
  }
  const missing = consentMissingFor(update);
  if (missing.length > 0) {
    throw new AppError(403, "consent_required", "These fields need the explicit consent first", {
      fields: missing,
    });
  }
  const row = await repo.upsertProfile(deps.db, accountId, update, deps.now());
  // No row, no profile: the account was erased between the guard and here (#51).
  if (!row) throw new AppError(404, "not_found", "No live account");
  const photos = await listApprovedPhotos(deps.db, accountId);
  deps.logger.info({ accountId, prompts: update.prompts.length }, "profile saved");
  return {
    profile: toDocument(row),
    completeness: await completenessOf(deps, accountId, row, photos.length),
  };
}

/** Erasure (#51): the profile row, inside the caller's transaction. */
export async function eraseProfileOfAccount(tx: Queryable, accountId: string): Promise<number> {
  return repo.deleteProfileOfAccount(tx, accountId);
}

/** The export (#51): the profile as written, or null. */
export async function exportProfile(
  db: Queryable,
  accountId: string,
): Promise<ProfileDocument | null> {
  const row = await repo.findProfile(db, accountId);
  return row ? toDocument(row) : null;
}
