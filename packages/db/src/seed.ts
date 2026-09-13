import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "./pool.ts";
import { matchingConfig, ponds } from "./schema/index.ts";

/** Otaniemi first, then the city, then the region (project context §1). */
export const SEED_PONDS = [
  {
    slug: "paakaupunkiseutu",
    nameNominative: "Pääkaupunkiseutu",
    nameInessive: "Pääkaupunkiseudulla",
    parent: null,
  },
  { slug: "espoo", nameNominative: "Espoo", nameInessive: "Espoossa", parent: "paakaupunkiseutu" },
  { slug: "otaniemi", nameNominative: "Otaniemi", nameInessive: "Otaniemessä", parent: "espoo" },
] as const;

/**
 * matching_config version 1: the defaults from the decisions log. Changing a
 * number here is a decision (ADR or a new config version), never a test edit.
 */
export const MATCHING_CONFIG_V1 = {
  gate_k: 30, // TD-10: matching opens per person at an eligible pool of 30
  majority_share_max: 0.6, // TD-10, TD-13: majority gender at most 60 % of active accounts
  round_size: 12, // TD-11
  impression_cap_per_day: 40, // TD-11: per candidate
  like_budget_balanced: 12, // TD-14
  like_budget_contested: 5, // TD-14
  contest_ratio_threshold: 1.5, // TD-13, TD-14: above this, the contested budget applies
  liked_you_cap: 10, // TD-11: pending likes appended per day
  like_expiry_days: 14, // TD-11
  pass_cooldown_days: 90, // TD-12
  shown_cooldown_days: 30, // TD-12
  silent_match_archive_days: 7, // TD-13
} as const;

export type SeedResult = { ponds: number; matchingConfig: number };

/** Idempotent: upserts keyed by slug and by (key, version). Safe to run on every boot of a preview. */
export async function seed(pool: Pool, createdBy = "seed"): Promise<SeedResult> {
  const db = drizzle(pool);

  for (const pond of SEED_PONDS) {
    const parentId = pond.parent
      ? (await db.select({ id: ponds.id }).from(ponds).where(eq(ponds.slug, pond.parent)))[0]?.id
      : null;
    if (pond.parent && !parentId) throw new Error(`seed order: parent ${pond.parent} missing`);
    await db
      .insert(ponds)
      .values({
        slug: pond.slug,
        nameNominative: pond.nameNominative,
        nameInessive: pond.nameInessive,
        parentId: parentId ?? null,
      })
      .onConflictDoUpdate({
        target: ponds.slug,
        set: {
          nameNominative: pond.nameNominative,
          nameInessive: pond.nameInessive,
          parentId: parentId ?? null,
        },
      });
  }

  for (const [key, value] of Object.entries(MATCHING_CONFIG_V1)) {
    await db
      .insert(matchingConfig)
      .values({ version: 1, key, value, createdBy })
      .onConflictDoUpdate({
        target: [matchingConfig.key, matchingConfig.version],
        set: { value },
      });
  }

  return { ponds: SEED_PONDS.length, matchingConfig: Object.keys(MATCHING_CONFIG_V1).length };
}
