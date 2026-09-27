import type { Queryable } from "@kuutti/db";

/**
 * Many verified people at once, for figures that only mean something in
 * numbers (#54). Plain SQL like `signedInAccount`: a test of one slice may
 * not import another's internals. No sessions: nobody here signs in.
 */
export type PeopleOptions = {
  gender?: "woman" | "man" | "non_binary" | null;
  state?: "registered" | "active" | "paused" | "shadow_banned" | "suspended" | "banned" | "deleted";
  standing?: "ok" | "suspended" | "banned";
  /** A complete profile by the rule of #47: a name, a bio, three approved photos, both hard rows, active. */
  complete?: boolean;
};

let batch = 0;

export async function pondNamed(db: Queryable, slug: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO ponds (slug, name_nominative, name_inessive) VALUES ($1, $2, $3) RETURNING id`,
    [slug, `Pond ${slug}`, `Pondissa ${slug}`],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("test pond not written");
  return id;
}

export async function people(
  db: Queryable,
  pondId: string | null,
  count: number,
  options: PeopleOptions = {},
): Promise<string[]> {
  if (count === 0) return [];
  batch += 1;
  const state = options.complete ? "active" : (options.state ?? "registered");
  const { rows } = await db.query<{ id: string }>(
    `WITH ids AS (
       INSERT INTO identity (hetu_hmac, standing)
       SELECT 'kuutti test people ' || $1 || ' ' || g, $2::identity_standing
       FROM generate_series(1, $3::int) g
       RETURNING id)
     INSERT INTO account (identity_id, state, birth_year, birth_month, gender, pond_id)
     SELECT id, $4::account_state, 1990, 6, $5::gender, $6 FROM ids
     RETURNING id`,
    [
      `${process.pid}-${batch}`,
      options.standing ?? "ok",
      count,
      state,
      options.gender ?? null,
      pondId,
    ],
  );
  const ids = rows.map((r) => r.id);
  if (options.complete) {
    await db.query(
      `INSERT INTO profile (account_id, display_name, bio, fields, prompts)
       SELECT id, 'Aino', $2, '{}'::jsonb, '[]'::jsonb FROM unnest($1::uuid[]) AS id`,
      [ids, "A bio that is long enough to count as one, by the rule of the profile."],
    );
    await db.query(
      `INSERT INTO photo (account_id, key, blurhash, width, height, state, position)
       SELECT id, md5(id::text || n::text), 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', 800, 1067, 'approved', n
       FROM unnest($1::uuid[]) AS id, generate_series(0, 2) n`,
      [ids],
    );
    await db.query(
      `INSERT INTO preferences (account_id, field, value, mode, include_unknown)
       SELECT id, f.field, f.value::jsonb, 'hard', false
       FROM unnest($1::uuid[]) AS id,
            (VALUES ('seeks', '["man"]'), ('age_window', '{"min":25,"max":40}')) AS f(field, value)`,
      [ids],
    );
  }
  return ids;
}
