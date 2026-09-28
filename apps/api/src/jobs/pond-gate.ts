import { type Queryable, transaction } from "@kuutti/db";
import { type GateResponse, waitlistK } from "@kuutti/schema";
import { CURRENT_CONSENT_VERSIONS } from "../identity/index.ts";
import type { Logger } from "../lib/logger.ts";
import { matchingConfigNumber } from "../lib/matching-config.ts";
import { inEachOthersPool, type PoolPerson, preferencesFrom } from "../matching/index.ts";
import {
  type Applicant,
  admit,
  GATE_EMPTIED,
  neededFrom,
  readGateRow,
  sayPlace,
  sayPool,
  WAITLIST_K_KEY,
} from "../pond/index.ts";
import { ageInYears, answeredPromptsOf, completeness } from "../profile/index.ts";
import type { NightlyJob } from "./nightly.ts";

/**
 * The count behind the pond gate (#94, ADR-015; TD-10, TD-13): who of a pond
 * is let in, how large everybody's pool is, and for whom matching opens. It
 * lives here and not in a slice because it reads across several (accounts,
 * consents, profiles, photos, preferences, ponds) and none of them should
 * depend on the others for it (rules/layout.md), as the waitlist counter's
 * count does. The rules it applies are pure functions of the slices:
 * `admit`, `sayPool` and `sayPlace` of the pond, `inEachOthersPool` of
 * matching, `completeness` of the profile.
 *
 * The exact figures, how large a pool is and which place in the line, exist
 * in memory while a count runs. What is written, said, exported and logged
 * is in steps (ADR-015 §6).
 *
 * Raw parameterised SQL for the same reason as pond/repo.ts. No statement
 * takes input from a request but the caller's own account id; what is put
 * into a statement's text is a constant of the code.
 */
export type GateDeps = { db: Queryable; logger: Logger; now: () => Date };

/** One count at a time, across every process that may run one; not the waitlist counter's lock. */
export const GATE_LOCK_KEY = 725_121_155;

export const GATE_K_KEY = "gate_k";
export const MAJORITY_SHARE_KEY = "majority_share_max";

type FactsRow = {
  id: string;
  gender: string | null;
  state: string;
  birth_year: number | null;
  birth_month: number | null;
  registered_at: Date;
  display_name: string | null;
  bio: string | null;
  prompts: unknown;
  approved_photos: string;
  seeks: unknown;
  age_window: unknown;
  terms: boolean;
  privacy: boolean;
  gate_pond: string | null;
  admitted_at: Date | null;
  pool_said: number | null;
  opened_at: Date | null;
};

/** A person whose profile and onboarding are complete, as the count sees them. */
type Subject = Applicant & {
  person: PoolPerson;
  /** Seen by others: a shadow-banned person has a gate of their own and is in nobody's pool. */
  visible: boolean;
  admittedAt: Date | null;
  poolSaid: number | null;
  openedAt: Date | null;
};

// Who has a gate: live accounts in good standing. `registered` has none (no
// consents yet), paused, suspended and banned accounts are hidden or gone.
const FACTS = `
  SELECT a.id, a.gender, a.state, a.birth_year, a.birth_month, a.registered_at,
         p.display_name, p.bio, p.prompts,
         (SELECT count(*) FROM photo ph
           WHERE ph.account_id = a.id AND ph.state = 'approved') AS approved_photos,
         (SELECT r.value FROM preferences r
           WHERE r.account_id = a.id AND r.mode = 'hard' AND r.field = 'seeks') AS seeks,
         (SELECT r.value FROM preferences r
           WHERE r.account_id = a.id AND r.mode = 'hard' AND r.field = 'age_window') AS age_window,
         EXISTS (SELECT 1 FROM consent c WHERE c.account_id = a.id AND c.kind = 'terms'
                  AND c.withdrawn_at IS NULL AND c.version = $2) AS terms,
         EXISTS (SELECT 1 FROM consent c WHERE c.account_id = a.id AND c.kind = 'privacy'
                  AND c.withdrawn_at IS NULL AND c.version = $3) AS privacy,
         g.pond_id AS gate_pond, g.admitted_at, g.pool_said, g.opened_at
  FROM account a
  JOIN identity i ON i.id = a.identity_id
  LEFT JOIN profile p ON p.account_id = a.id
  LEFT JOIN gate g ON g.account_id = a.id
  WHERE a.pond_id = $1
    AND a.state IN ('active', 'shadow_banned')
    AND i.standing = 'ok'`;

/**
 * The row as a subject, or null while something is missing: the profile's
 * completeness (#47) and onboarding's (ADR-010 §6: a consent for an older
 * wording reads as none) are both asked, by the rules the person's own
 * screens are told by.
 */
function subjectFrom(row: FactsRow, pondId: string, at: Date): Subject | null {
  const preferences = preferencesFrom({ seeks: row.seeks, ageWindow: row.age_window });
  const gender = row.gender as Subject["gender"] | null;
  if (!gender || !preferences.seeks || !preferences.ageWindow) return null;
  if (row.birth_year === null || row.birth_month === null) return null;
  if (!row.terms || !row.privacy) return null;
  const complete = completeness({
    displayName: row.display_name,
    bio: row.bio,
    answeredPrompts: answeredPromptsOf(row.prompts),
    approvedPhotos: Number(row.approved_photos),
    seeks: preferences.seeks,
    ageWindow: preferences.ageWindow,
  }).complete;
  if (!complete) return null;
  // A row of another pond is of a pond the person left: they begin anew here.
  const here = row.gate_pond === pondId;
  return {
    id: row.id,
    gender,
    seeks: preferences.seeks,
    registeredAt: row.registered_at,
    admitted: here && row.admitted_at !== null,
    person: {
      gender,
      seeks: preferences.seeks,
      ageWindow: preferences.ageWindow,
      age: ageInYears(row.birth_year, row.birth_month, at),
    },
    visible: row.state === "active",
    admittedAt: here ? row.admitted_at : null,
    poolSaid: here && row.admitted_at !== null ? row.pool_said : null,
    openedAt: here ? row.opened_at : null,
  };
}

export type GateCount = {
  ponds: number;
  /** People with a complete profile, who have a gate. */
  counted: number;
  /** Newly let into their pond by this count. */
  admitted: number;
  waiting: number;
  /** For whom matching opened in this count. */
  opened: number;
};

type Written = {
  accountId: string;
  admittedAt: Date | null;
  placeSaid: number | null;
  poolSaid: number;
  openedAt: Date | null;
};

async function countPond(
  tx: Queryable,
  pondId: string,
  config: { gateK: number; shareMax: number; step: number },
  at: Date,
  only: string | undefined,
): Promise<Omit<GateCount, "ponds">> {
  const { rows } = await tx.query<FactsRow>(FACTS, [
    pondId,
    CURRENT_CONSENT_VERSIONS.terms,
    CURRENT_CONSENT_VERSIONS.privacy,
  ]);
  const subjects = rows.flatMap((row) => subjectFrom(row, pondId, at) ?? []);
  const admission = admit(subjects, config.shareMax);
  const newly = new Set(admission.admitted);
  const inside = (subject: Subject) => subject.admitted || newly.has(subject.id);
  const shown = subjects.filter((subject) => subject.visible && inside(subject));

  const written: Written[] = [];
  let opened = 0;
  for (const subject of subjects) {
    if (only !== undefined && subject.id !== only) continue;
    if (!inside(subject)) {
      const place = admission.waiting.get(subject.id);
      written.push({
        accountId: subject.id,
        admittedAt: null,
        placeSaid: place === undefined ? null : sayPlace(place, config.step),
        poolSaid: 0,
        openedAt: null,
      });
      continue;
    }
    let pool = 0;
    for (const other of shown) {
      if (other.id !== subject.id && inEachOthersPool(subject.person, other.person)) pool += 1;
    }
    const opens = subject.openedAt === null && pool >= config.gateK;
    if (opens) opened += 1;
    written.push({
      accountId: subject.id,
      admittedAt: subject.admittedAt ?? at,
      placeSaid: null,
      poolSaid: sayPool(subject.poolSaid, pool, config.step),
      openedAt: subject.openedAt ?? (opens ? at : null),
    });
  }

  if (written.length > 0) {
    // One statement for the pond. The account is asked once more, under a
    // lock: an erasure that finished meanwhile gets no row, and a change of
    // pond none for the pond that was left (ADR-015 §8).
    await tx.query(
      `INSERT INTO gate (account_id, pond_id, admitted_at, place_said, pool_said, opened_at, counted_at)
       SELECT u.account_id, $2, u.admitted_at, u.place_said, u.pool_said, u.opened_at, $8
       FROM unnest($1::uuid[], $3::timestamptz[], $4::int[], $5::int[], $6::timestamptz[])
            AS u(account_id, admitted_at, place_said, pool_said, opened_at)
       JOIN account a ON a.id = u.account_id
        AND a.pond_id = $2 AND a.state = ANY($7::account_state[])
       FOR SHARE OF a
       ON CONFLICT (account_id) DO UPDATE
         SET pond_id = EXCLUDED.pond_id, admitted_at = EXCLUDED.admitted_at,
             place_said = EXCLUDED.place_said, pool_said = EXCLUDED.pool_said,
             opened_at = EXCLUDED.opened_at, counted_at = EXCLUDED.counted_at`,
      [
        written.map((w) => w.accountId),
        pondId,
        written.map((w) => w.admittedAt),
        written.map((w) => w.placeSaid),
        written.map((w) => w.poolSaid),
        written.map((w) => w.openedAt),
        ["active", "shadow_banned"],
        at,
      ],
    );
  }
  return {
    counted: written.length,
    admitted: written.filter((w) => newly.has(w.accountId)).length,
    waiting: written.filter((w) => w.admittedAt === null).length,
    opened,
  };
}

async function readConfig(db: Queryable) {
  return {
    gateK: await matchingConfigNumber(db, GATE_K_KEY),
    shareMax: await matchingConfigNumber(db, MAJORITY_SHARE_KEY),
    // The step of everything that is said about people in numbers (ADR-013).
    step: waitlistK(await matchingConfigNumber(db, WAITLIST_K_KEY)),
  };
}

/**
 * Counts the gates of every pond somebody lives in, or of one pond. Counting
 * twice changes nothing the second time.
 */
export async function countGates(
  deps: GateDeps,
  scope: { pondId?: string } = {},
): Promise<GateCount> {
  const at = deps.now();
  const result = await transaction(deps.db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [GATE_LOCK_KEY]);
    const config = await readConfig(tx);
    // What a statement elsewhere should have done and a race kept it from
    // (ADR-015 §8): the row of an account that is gone goes, and the row of a
    // pond that was left is emptied, for this count to decide anew.
    await tx.query(
      `DELETE FROM gate g USING account a
       WHERE a.id = g.account_id AND (a.state = 'deleted' OR a.pond_id IS NULL)`,
    );
    await tx.query(
      `UPDATE gate g SET pond_id = a.pond_id, ${GATE_EMPTIED}
       FROM account a WHERE a.id = g.account_id AND a.pond_id <> g.pond_id`,
    );
    const ponds = scope.pondId
      ? [scope.pondId]
      : (
          await tx.query<{ pond_id: string }>(
            `SELECT DISTINCT pond_id FROM account
             WHERE pond_id IS NOT NULL AND state IN ('active', 'shadow_banned')`,
          )
        ).rows.map((row) => row.pond_id);
    const total: GateCount = {
      ponds: ponds.length,
      counted: 0,
      admitted: 0,
      waiting: 0,
      opened: 0,
    };
    for (const pondId of ponds) {
      const pond = await countPond(tx, pondId, config, at, undefined);
      total.counted += pond.counted;
      total.admitted += pond.admitted;
      total.waiting += pond.waiting;
      total.opened += pond.opened;
    }
    return total;
  });
  // How many, never who or where: nothing of anybody's preferences is in a log line (TD-14).
  deps.logger.info(result, "pond gates counted");
  return result;
}

/**
 * The one count outside the night: a person who was never counted, the
 * first time they ask, alone. Nobody else's row is written, so asking moves
 * nobody's figure. Whether it counted; when another count holds the lock it
 * does not wait for it, and the person is told that the night will say.
 *
 * Its log line has no outcome: beside the request's line, which names the
 * account, "one waits" would say that this person does not seek their own
 * gender (TD-14).
 */
async function countFirst(deps: GateDeps, pondId: string, accountId: string): Promise<boolean> {
  const at = deps.now();
  const counted = await transaction(deps.db, async (tx) => {
    const { rows: lock } = await tx.query<{ got: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1) AS got",
      [GATE_LOCK_KEY],
    );
    if (!lock[0]?.got) return false;
    // Asked again under the lock: of several first asks at once, one counts.
    const { rows } = await tx.query("SELECT 1 FROM gate WHERE account_id = $1", [accountId]);
    if (rows.length > 0) return false;
    await countPond(tx, pondId, await readConfig(tx), at, accountId);
    return true;
  });
  if (counted) deps.logger.info({}, "pond gate counted on a first ask");
  return counted;
}

/**
 * The caller's own gate (rule 6: every statement names the caller). A person
 * who is complete and was never counted is counted now, alone. Everything
 * after that is the night's: a change of preferences, of gender or of pond
 * shows in what the person is told after the next count, never on asking,
 * so nobody can put questions to the figure one after another (ADR-015 §7).
 */
export async function gateOf(deps: GateDeps, accountId: string): Promise<GateResponse> {
  const step = waitlistK(await matchingConfigNumber(deps.db, WAITLIST_K_KEY));
  const say = (gate: Omit<GateResponse, "step">): GateResponse => ({ ...gate, step });
  const nothing = { within: null, needed: null };

  const { rows: mine } = await deps.db.query<{ pond_id: string | null }>(
    "SELECT pond_id FROM account WHERE id = $1 AND state IN ('active', 'shadow_banned')",
    [accountId],
  );
  const pondId = mine[0]?.pond_id ?? null;
  if (!pondId) return say({ state: "incomplete", ...nothing });
  const { rows } = await deps.db.query<FactsRow>(`${FACTS} AND a.id = $4`, [
    pondId,
    CURRENT_CONSENT_VERSIONS.terms,
    CURRENT_CONSENT_VERSIONS.privacy,
    accountId,
  ]);
  const row = rows[0];
  if (!row || !subjectFrom(row, pondId, deps.now())) {
    return say({ state: "incomplete", ...nothing });
  }

  let gate = await readGateRow(deps.db, accountId);
  if (!gate && (await countFirst(deps, pondId, accountId))) {
    gate = await readGateRow(deps.db, accountId);
  }
  if (!gate || gate.pondId !== pondId || gate.countedAt === null) {
    return say({ state: "pending", ...nothing });
  }
  if (gate.openedAt) return say({ state: "open", ...nothing });
  if (!gate.admittedAt) {
    return gate.placeSaid === null
      ? say({ state: "pending", ...nothing })
      : say({ state: "waiting", within: gate.placeSaid, needed: null });
  }
  const gateK = await matchingConfigNumber(deps.db, GATE_K_KEY);
  return say({ state: "closed", within: null, needed: neededFrom(gate.poolSaid, gateK) });
}

/** The nightly job: every pond's gates. */
export function gateJob(deps: GateDeps): NightlyJob {
  return {
    name: "pond-gate",
    run: async () => {
      const { ponds, counted, admitted, waiting, opened } = await countGates(deps);
      return { ponds, counted, admitted, waiting, opened };
    },
  };
}
