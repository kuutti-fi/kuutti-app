import type { Queryable } from "@kuutti/db";
import { AppError } from "./errors.ts";

/**
 * Every tunable is a row in matching_config, never a constant in code
 * (CLAUDE.md Product constraints). The latest version of a key wins. A key
 * that is missing is a deployment without its seed, which is an error to
 * surface, not a default to fall back on.
 */
export async function readMatchingConfig(db: Queryable, key: string): Promise<unknown> {
  const { rows } = await db.query<{ value: unknown }>(
    "SELECT value FROM matching_config WHERE key = $1 ORDER BY version DESC LIMIT 1",
    [key],
  );
  if (rows.length === 0) {
    throw new AppError(500, "internal_error", `matching_config has no row for ${key}`, { key });
  }
  return rows[0]?.value;
}

export async function matchingConfigNumber(db: Queryable, key: string): Promise<number> {
  const value = await readMatchingConfig(db, key);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AppError(500, "internal_error", `matching_config ${key} is not a number`, { key });
  }
  return value;
}
