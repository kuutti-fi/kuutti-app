import type { Queryable } from "@kuutti/db";
import type { PondSummary } from "@kuutti/schema";

// Raw parameterised SQL for the same reason as identity/repo.ts: Deps.db is
// the Queryable seam the test harness hands a rolled-back transaction through.
// Ponds are public structure, not user data: the list is the same for
// everyone. The one statement about a person, setPondOfAccount, carries the
// caller's account id (rule 6).

type Row = Record<string, unknown>;

const pondFrom = (r: Row): PondSummary => ({
  id: r.id as string,
  slug: r.slug as string,
  name: r.name_nominative as string,
  nameInessive: r.name_inessive as string,
  parentId: (r.parent_id as string | null) ?? null,
});

const COLUMNS = "id, slug, name_nominative, name_inessive, parent_id";

/** Every pond, parents first, so the app can show the tree in order. */
export async function listPonds(db: Queryable): Promise<PondSummary[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM ponds ORDER BY parent_id IS NOT NULL, name_nominative`,
  );
  return rows.map(pondFrom);
}

export async function findPondOfAccount(
  db: Queryable,
  accountId: string,
): Promise<PondSummary | null> {
  const { rows } = await db.query<Row>(
    `SELECT p.id, p.slug, p.name_nominative, p.name_inessive, p.parent_id
     FROM account a JOIN ponds p ON p.id = a.pond_id WHERE a.id = $1`,
    [accountId],
  );
  return rows[0] ? pondFrom(rows[0]) : null;
}

/** The choice; a tombstone takes none (#51) and an unknown pond is refused. */
export async function setPondOfAccount(
  db: Queryable,
  accountId: string,
  pondId: string,
): Promise<"set" | "no_pond" | "no_account"> {
  const result = await db.query(
    `UPDATE account SET pond_id = $2
     WHERE id = $1 AND state <> 'deleted' AND EXISTS (SELECT 1 FROM ponds WHERE id = $2)`,
    [accountId, pondId],
  );
  if (result.rowCount === 1) return "set";
  const { rows } = await db.query("SELECT 1 FROM ponds WHERE id = $1", [pondId]);
  return rows.length === 0 ? "no_pond" : "no_account";
}
