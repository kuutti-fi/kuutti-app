import { createHash } from "node:crypto";
import type { Queryable } from "../pool.ts";
import { transaction } from "../pool.ts";
import { DEMO_LABEL_PREFIX, type SyntheticPerson } from "./population.ts";

/**
 * Writes the synthetic population (#73, ADR-014) and removes the one that was
 * there. Replacing, not adding: the command can be run again, with another
 * size or another seed, and what is in the database is what the generator
 * says, no more.
 *
 * A synthetic identity cannot be confused with a person. Its `hetu_hmac` is a
 * hash of its label, as the seed's own identities are, so no bank login maps
 * to it; and `broker_subject` carries the mark the removal finds it by, which
 * no broker would ever send.
 *
 * Raw parameterised SQL over the Queryable seam, as the API's repositories
 * use: a test hands in a rolled-back transaction. No statement takes input
 * from a request; this runs from the command line against a local or preview
 * database and refuses production before it connects (the command does).
 */

/** What marks an identity as made by this module. */
export const DEMO_SUBJECT_PREFIX = "kuutti-demo:";

export const demoHetuHmac = (label: string): string =>
  createHash("sha256").update(`kuutti demo identity: ${label}`).digest("hex");

export type ConsentVersions = Readonly<Record<"terms" | "privacy" | "research", string>>;

export type WriteResult = { removed: number; written: number; ponds: Record<string, number> };

/** The tables that hold rows of an account, in an order in which they can be emptied. */
const ACCOUNT_TABLES = [
  "photo_access",
  "card_shown",
  "photo",
  "research_subject",
  "consent",
  "preferences",
  "profile",
  "session",
  "auth_request",
] as const;

/** Removes every synthetic identity with everything of its accounts. Returns how many there were. */
export async function removePopulation(db: Queryable): Promise<number> {
  return transaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      "SELECT id FROM identity WHERE broker_subject LIKE $1",
      [`${DEMO_SUBJECT_PREFIX}%`],
    );
    const identities = rows.map((r) => r.id);
    if (identities.length === 0) return 0;
    const accounts = (
      await tx.query<{ id: string }>("SELECT id FROM account WHERE identity_id = ANY($1)", [
        identities,
      ])
    ).rows.map((r) => r.id);
    for (const table of ACCOUNT_TABLES) {
      await tx.query(`DELETE FROM ${table} WHERE account_id = ANY($1)`, [accounts]);
    }
    await tx.query("DELETE FROM account WHERE id = ANY($1)", [accounts]);
    await tx.query("DELETE FROM identity WHERE id = ANY($1)", [identities]);
    return identities.length;
  });
}

export async function writePopulation(
  db: Queryable,
  people: readonly SyntheticPerson[],
  consentVersions: ConsentVersions,
): Promise<WriteResult> {
  for (const person of people) {
    if (!person.label.startsWith(DEMO_LABEL_PREFIX)) {
      throw new Error(`not a synthetic person: ${person.label}`);
    }
  }
  return transaction(db, async (tx) => {
    const removed = await removePopulation(tx);
    const pondIds = new Map(
      (await tx.query<{ id: string; slug: string }>("SELECT id, slug FROM ponds")).rows.map((r) => [
        r.slug,
        r.id,
      ]),
    );
    const ponds: Record<string, number> = {};
    for (const person of people) {
      const pondId = person.pond === null ? null : pondIds.get(person.pond);
      if (pondId === undefined) throw new Error(`no pond ${person.pond}: run the seed first`);
      if (person.pond !== null) ponds[person.pond] = (ponds[person.pond] ?? 0) + 1;

      const identity = await tx.query<{ id: string }>(
        `INSERT INTO identity (hetu_hmac, standing, broker_subject, created_at)
         VALUES ($1, 'ok', $2, $3) RETURNING id`,
        [demoHetuHmac(person.label), `${DEMO_SUBJECT_PREFIX}${person.label}`, person.registeredAt],
      );
      const account = await tx.query<{ id: string }>(
        `INSERT INTO account
           (identity_id, state, state_changed_at, birth_year, birth_month, gender, pond_id, registered_at)
         VALUES ($1, $2::account_state, $3, $4, $5, $6::gender, $7, $8) RETURNING id`,
        [
          identity.rows[0]?.id,
          person.state,
          person.consents[0]?.givenAt ?? null,
          person.birthYear,
          person.birthMonth,
          person.gender,
          pondId,
          person.registeredAt,
        ],
      );
      const accountId = account.rows[0]?.id;
      if (!accountId) throw new Error(`account of ${person.label} not written`);

      for (const consent of person.consents) {
        await tx.query(
          `INSERT INTO consent (account_id, kind, version, locale_shown, given_at)
           VALUES ($1, $2::consent_kind, $3, $4, $5)`,
          [
            accountId,
            consent.kind,
            consentVersions[consent.kind],
            consent.localeShown,
            consent.givenAt,
          ],
        );
      }
      if (person.preferences) {
        for (const [field, value] of [
          ["seeks", person.preferences.seeks],
          ["age_window", person.preferences.ageWindow],
        ] as const) {
          await tx.query(
            `INSERT INTO preferences (account_id, field, value, mode, created_at, updated_at)
             VALUES ($1, $2, $3::jsonb, 'hard', $4, $4)`,
            [accountId, field, JSON.stringify(value), person.registeredAt],
          );
        }
      }
      if (person.profile) {
        await tx.query(
          `INSERT INTO profile
             (account_id, display_name, bio, bio_preset, fields, prompts, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $7)`,
          [
            accountId,
            person.profile.displayName,
            person.profile.bio,
            person.profile.bioPreset,
            JSON.stringify(person.profile.fields),
            JSON.stringify(person.profile.prompts),
            person.registeredAt,
          ],
        );
      }
    }
    return { removed, written: people.length, ponds };
  });
}
