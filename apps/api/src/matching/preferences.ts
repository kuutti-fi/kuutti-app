import { type Queryable, transaction } from "@kuutti/db";
import {
  AgeWindow,
  Gender,
  type PreferencesResponse,
  type PreferencesUpdate,
} from "@kuutti/schema";
import { z } from "zod";

// Raw parameterised SQL for the same reason as identity/repo.ts: Deps.db is
// the Queryable seam the test harness hands a rolled-back transaction through.
// preferences(account_id, field, value, mode, include_unknown), rules/db.md:
// one row per field, deal-breakers are mode = hard. Onboarding (#46) writes
// the two hard rows nothing can start without; the round builder of M4 joins
// both parties' hard rows. Every statement carries the caller's account id
// (rule 6), and no log line here carries seeks (rule 5, checklist line 66).

const SEEKS = "seeks";
const AGE_WINDOW = "age_window";

type Row = { field: string; value: unknown };

/** The two hard rows as the person set them; a row that no longer parses reads as unset. */
export async function readPreferences(
  db: Queryable,
  accountId: string,
): Promise<PreferencesResponse> {
  const { rows } = await db.query<Row>(
    `SELECT field, value FROM preferences
     WHERE account_id = $1 AND mode = 'hard' AND field IN ($2, $3)`,
    [accountId, SEEKS, AGE_WINDOW],
  );
  const byField = new Map(rows.map((r) => [r.field, r.value]));
  return {
    seeks: z.array(Gender).min(1).safeParse(byField.get(SEEKS)).data ?? null,
    ageWindow: AgeWindow.safeParse(byField.get(AGE_WINDOW)).data ?? null,
  };
}

/** Both rows, written or replaced together; a tombstone takes none (#51). */
export async function savePreferences(
  db: Queryable,
  accountId: string,
  update: PreferencesUpdate,
  at: Date,
): Promise<boolean> {
  return transaction(db, async (tx) => {
    // The lock erasure takes first (ADR-009 §8): a save racing an erasure
    // lands before the deletes or sees the tombstone and writes nothing.
    const live = await tx.query(
      "SELECT 1 FROM account WHERE id = $1 AND state <> 'deleted' FOR UPDATE",
      [accountId],
    );
    if (live.rows.length === 0) return false;
    let written = 0;
    for (const [field, value] of [
      [SEEKS, update.seeks],
      [AGE_WINDOW, update.ageWindow],
    ] as const) {
      const result = await tx.query(
        `INSERT INTO preferences (account_id, field, value, mode, include_unknown, created_at, updated_at)
         SELECT $1, $2, $3::jsonb, 'hard', false, $4, $4
         WHERE EXISTS (SELECT 1 FROM account WHERE id = $1 AND state <> 'deleted')
         ON CONFLICT (account_id, field) DO UPDATE
           SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [accountId, field, JSON.stringify(value), at],
      );
      written += result.rowCount ?? 0;
    }
    return written === 2;
  });
}

/** Erasure (TD-7, #51): every preference row of the account. */
export async function deletePreferencesOfAccount(
  db: Queryable,
  accountId: string,
): Promise<number> {
  const result = await db.query("DELETE FROM preferences WHERE account_id = $1", [accountId]);
  return result.rowCount ?? 0;
}
