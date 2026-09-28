import type { Queryable } from "@kuutti/db";
import type { ExportedGate, Gender } from "@kuutti/schema";

/**
 * The pond gate's rules (#94, ADR-015; TD-10, TD-13, TD-14), pure, and the
 * rows they are kept in. Two things happen to a person with a complete
 * profile, in this order:
 *
 * 1. **Admission.** Most are let into the pond at once. Where one gender is
 *    the larger group among those who seek another gender than their own, its
 *    newcomers wait in the order they registered once it would be more than
 *    its share (`majority_share_max`). Nobody is let out when the pond drifts.
 * 2. **The gate.** Matching opens for an admitted person when the people who
 *    could be shown to them, and they to those, number `gate_k`. It does not
 *    close again: a pool that shrinks makes shorter rounds (TD-11).
 *
 * The rules name no gender: they speak of the larger group, whichever it is
 * (TD-14). What a person is told of either is said in steps, never exactly
 * (`sayPool`, `sayPlace`), and only that is kept. The counting itself reads
 * across slices and lives with the nightly jobs (`jobs/pond-gate.ts`).
 */

/** A person as admission sees them. */
export type Applicant = {
  id: string;
  gender: Gender;
  seeks: readonly Gender[];
  registeredAt: Date;
  /** Let in by an earlier count; no count takes it back. */
  admitted: boolean;
};

/** The two groups the share is kept between; everybody else is admitted at once. */
export type ContestedGroup = "woman" | "man";

/**
 * The group a person waits with, or null when they wait with nobody: people
 * who seek their own gender too, and non-binary people, are admitted at once
 * (TD-13, TD-14).
 */
export function contestedGroup(person: Pick<Applicant, "gender" | "seeks">): ContestedGroup | null {
  if (person.gender === "non_binary") return null;
  return person.seeks.includes(person.gender) ? null : person.gender;
}

export type Admission = {
  /** Newly let in by this count, in the order they were. */
  admitted: string[];
  /** Who waits, with their place among those of their group: 1 is next. */
  waiting: Map<string, number>;
};

const byRegistration = (a: Applicant, b: Applicant) =>
  a.registeredAt.getTime() - b.registeredAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Who of one pond is let in now. The larger of the two groups is admitted
 * while it is at most `shareMax` of both; the smaller, and either while they
 * are equal, always. Within a group the order is the order of registration,
 * and between the two the earlier registration goes first, so a newcomer of
 * the smaller group opens the way for those who waited.
 *
 * At small numbers the share can stand above `shareMax` (two of three is
 * more than 60 %): the rule is about who is let in next, not a promise about
 * the ratio, which also drifts as people leave (TD-13).
 */
export function admit(people: readonly Applicant[], shareMax: number): Admission {
  const count: Record<ContestedGroup, number> = { woman: 0, man: 0 };
  const queue: Record<ContestedGroup, Applicant[]> = { woman: [], man: [] };
  const admitted: Applicant[] = [];
  for (const person of people) {
    const group = contestedGroup(person);
    if (person.admitted) {
      if (group) count[group] += 1;
    } else if (group) {
      queue[group].push(person);
    } else {
      admitted.push(person);
    }
  }
  queue.woman.sort(byRegistration);
  queue.man.sort(byRegistration);

  const other = (group: ContestedGroup): ContestedGroup => (group === "woman" ? "man" : "woman");
  const mayEnter = (group: ContestedGroup) =>
    count[group] <= count[other(group)] ||
    (count[group] + 1) / (count.woman + count.man + 1) <= shareMax;

  for (;;) {
    const heads = (["woman", "man"] as const)
      .flatMap((group) => {
        const head = queue[group][0];
        return head && mayEnter(group) ? [{ group, head }] : [];
      })
      .sort((a, b) => byRegistration(a.head, b.head));
    const next = heads[0];
    if (!next) break;
    queue[next.group].shift();
    count[next.group] += 1;
    admitted.push(next.head);
  }

  const waiting = new Map<string, number>();
  for (const group of ["woman", "man"] as const) {
    queue[group].forEach((person, index) => {
      waiting.set(person.id, index + 1);
    });
  }
  return { admitted: admitted.sort(byRegistration).map((person) => person.id), waiting };
}

/**
 * Whether a person is let in as the recorded admissions stand, needing
 * nobody else's: the question of the one count that writes one row only, a
 * person's first ask (ADR-015 §7). `admit` decides for everybody at once,
 * and a place given on the strength of admissions that are not written
 * would stand when those never come about: somebody who registered later
 * would be inside, and the one before them in the line.
 *
 * So: people who wait with nobody are let in. Of the two groups, a person
 * is let in when nobody of their group who is not let in registered before
 * them, and their group may enter counting only those who are let in
 * already. Everybody else is told that the night will say.
 */
export function admitsAlone(people: readonly Applicant[], id: string, shareMax: number): boolean {
  const person = people.find((candidate) => candidate.id === id);
  if (!person) return false;
  if (person.admitted) return true;
  const group = contestedGroup(person);
  if (group === null) return true;
  const passes = people.some(
    (other) =>
      !other.admitted &&
      other.id !== id &&
      contestedGroup(other) === group &&
      byRegistration(other, person) < 0,
  );
  if (passes) return false;
  const recorded = people.filter((other) => other.admitted);
  return admit([...recorded, person], shareMax).admitted.includes(id);
}

/**
 * The size of a person's pool as it is said to them: in whole steps, rounded
 * down, the first figure like every later one. An exact pool would answer
 * whatever a person asks of it: with a window of one year of birth it says
 * whether the one person of that year seeks somebody like them, which is
 * what `seeks` says and what TD-14 keeps out of everything.
 *
 * On top of the rounding the figure follows slowly: it moves when the pool
 * is a whole step away from what was said, so a pool that goes back and
 * forth over a ten does not show each crossing.
 */
export function sayPool(said: number | null, pool: number, step: number): number {
  const rounded = Math.floor(pool / step) * step;
  if (said === null) return rounded;
  return Math.abs(pool - said) >= step ? rounded : said;
}

/**
 * The place in the line as it is said: among the next ten, the next twenty.
 * The line is of people who do not seek their own gender, so an exact place
 * that moved by one would say that of the one person who came or went.
 */
export function sayPlace(place: number, step: number): number {
  return Math.ceil(Math.max(1, place) / step) * step;
}

/** About how many more are needed, from what is said: never less than one while the gate is closed. */
export function neededFrom(said: number, gateK: number): number {
  return Math.max(1, Math.ceil(gateK) - said);
}

// --- The rows ---------------------------------------------------------------

export type GateRow = {
  pondId: string;
  admittedAt: Date | null;
  /** The place in the line as it is said (`sayPlace`); null unless the person waits. */
  placeSaid: number | null;
  poolSaid: number;
  openedAt: Date | null;
  /** Null while the row waits for the next count to decide anew. */
  countedAt: Date | null;
};

type Row = Record<string, unknown>;

/** The caller's own row (rule 6), or null before the first count. */
export async function readGateRow(db: Queryable, accountId: string): Promise<GateRow | null> {
  const { rows } = await db.query<Row>(
    `SELECT pond_id, admitted_at, place_said, pool_said, opened_at, counted_at
     FROM gate WHERE account_id = $1`,
    [accountId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    pondId: row.pond_id as string,
    admittedAt: (row.admitted_at as Date | null) ?? null,
    placeSaid: (row.place_said as number | null) ?? null,
    poolSaid: row.pool_said as number,
    openedAt: (row.opened_at as Date | null) ?? null,
    countedAt: (row.counted_at as Date | null) ?? null,
  };
}

/**
 * What an emptied row is set to, for the statements that empty one: the
 * person is neither let in nor in the line until the next count has decided.
 * The row itself stays, so that asking does not count them then and there
 * (ADR-015 §7): only a person who was never counted is counted on asking.
 * What was said of the pool stays too. It is what the next figure follows
 * slowly from, and a person who could empty it, by a pond there and back,
 * would have a fresh figure every night and see every crossing of a ten.
 */
export const GATE_EMPTIED =
  "admitted_at = NULL, place_said = NULL, opened_at = NULL, counted_at = NULL";

/** What a person declares of themselves, as far as admission reads it. */
export type Declared = { gender: string | null; seeks: readonly string[] | null };

const groupOf = (declared: Declared): ContestedGroup | null | undefined => {
  if (declared.gender === null || declared.seeks === null) return undefined;
  if (declared.gender === "non_binary") return null;
  if (declared.gender !== "woman" && declared.gender !== "man") return undefined;
  return declared.seeks.includes(declared.gender) ? null : declared.gender;
};

/** Whether a change of gender or of whom one seeks brings the person into a group that may have to wait. */
export function joinsAGroupThatWaits(before: Declared, after: Declared): boolean {
  const group = groupOf(after);
  return group !== null && group !== undefined && groupOf(before) !== group;
}

/**
 * Admission is decided anew for a person who joins one of the two groups
 * the share is kept between (ADR-015 §9). Without it a person of the larger
 * group would declare that they seek their own gender too, be let in at
 * once, and take the declaration back: past everybody who waits, and counted
 * into the share they wait behind. Called in the transaction that writes
 * the change, for the caller's own row (rule 6). Leaving such a group, or
 * changing anything else, takes nothing back.
 */
export async function admissionAnew(
  db: Queryable,
  accountId: string,
  before: Declared,
  after: Declared,
): Promise<boolean> {
  if (!joinsAGroupThatWaits(before, after)) return false;
  const result = await db.query(`UPDATE gate SET ${GATE_EMPTIED} WHERE account_id = $1`, [
    accountId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/** The export (#51): the row as it is held, which is what the person is told. */
export async function exportGate(db: Queryable, accountId: string): Promise<ExportedGate | null> {
  const row = await readGateRow(db, accountId);
  if (!row) return null;
  return {
    pondId: row.pondId,
    admittedAt: row.admittedAt?.toISOString() ?? null,
    placeSaid: row.placeSaid,
    poolSaid: row.poolSaid,
    openedAt: row.openedAt?.toISOString() ?? null,
    countedAt: row.countedAt?.toISOString() ?? null,
  };
}

/** Erasure (TD-7): the person's place at the gate. */
export async function deleteGateOfAccount(db: Queryable, accountId: string): Promise<number> {
  const result = await db.query("DELETE FROM gate WHERE account_id = $1", [accountId]);
  return result.rowCount ?? 0;
}
