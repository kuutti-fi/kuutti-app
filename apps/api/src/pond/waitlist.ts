import type { Queryable } from "@kuutti/db";
import {
  publishCounts,
  type WaitlistCounts,
  type WaitlistResponse,
  waitlistK,
} from "@kuutti/schema";
import { matchingConfigNumber } from "../lib/matching-config.ts";
import * as repo from "./repo.ts";

/**
 * The waitlist counter's public half (#54, ADR-013): for every pond the
 * figures it stands on, each through `publishCounts`, which says a number only
 * where at least k people stand behind it. The figures are written by the
 * nightly job in `jobs/waitlist-snapshot.ts`, which is where the accounts are
 * counted; nothing here reads a person's row.
 *
 * Raw parameterised SQL for the same reason as pond/repo.ts: Deps.db is the
 * Queryable seam the test harness hands a rolled-back transaction through.
 * The table holds aggregates per pond, the same for every reader, so there is
 * no caller to scope by (rule 6 is about a session's own rows).
 */
export const WAITLIST_K_KEY = "waitlist_k";

/** The threshold in force: `matching_config.waitlist_k`, never below the floor of packages/schema. */
export async function readWaitlistK(db: Queryable): Promise<number> {
  return waitlistK(await matchingConfigNumber(db, WAITLIST_K_KEY));
}

type FiguresRow = {
  pond_id: string;
  day: string;
  verified: number;
  woman: number;
  man: number;
  non_binary: number;
  finishing: number;
};

export type StandingFigures = { day: string; counts: WaitlistCounts };

/** The figures every pond stands on, exact: for the job that moves them and the read that publishes them. */
export async function readStandingFigures(db: Queryable): Promise<Map<string, StandingFigures>> {
  const { rows } = await db.query<FiguresRow>(
    `SELECT pond_id, to_char(day, 'YYYY-MM-DD') AS day, verified, woman, man, non_binary, finishing
     FROM waitlist_snapshot`,
  );
  return new Map(
    rows.map((row) => [
      row.pond_id,
      {
        day: row.day,
        counts: {
          verified: row.verified,
          woman: row.woman,
          man: row.man,
          nonBinary: row.non_binary,
          finishing: row.finishing,
        },
      },
    ]),
  );
}

/** Every pond, each with what may be said of it. */
export async function readWaitlist(db: Queryable): Promise<WaitlistResponse> {
  const k = await readWaitlistK(db);
  const standing = await readStandingFigures(db);
  const ponds = await repo.listPonds(db);
  return {
    k,
    ponds: ponds.map((pond) => {
      // A pond created after the last count has no row yet: listed, with no number.
      const figures = standing.get(pond.id) ?? null;
      const published = publishCounts(figures?.counts ?? null, k);
      // No number, no day: when a small pond was last counted is nobody's business.
      return {
        pond,
        day: published.verified === null ? null : (figures?.day ?? null),
        ...published,
      };
    }),
  };
}
