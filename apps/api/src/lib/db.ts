import type { Queryable } from "@kuutti/db";

/** SELECT 1 under a hard timeout. Unreachable is a state, not an exception. */
export async function checkDb(db: Queryable, timeoutMs: number): Promise<"ok" | "unreachable"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"unreachable">((resolve) => {
    timer = setTimeout(() => resolve("unreachable"), timeoutMs);
  });
  try {
    return await Promise.race([db.query("SELECT 1 AS one").then((): "ok" => "ok"), timeout]);
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
