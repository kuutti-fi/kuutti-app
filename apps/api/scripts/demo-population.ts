/**
 * Writes the synthetic population of #73 (ADR-014) into a local or preview
 * database, replacing the one that was there.
 *
 *   pnpm demo:population                      three hundred people, the usual seed
 *   pnpm demo:population -- --size 5000       as many as the round builder must carry
 *   pnpm demo:population -- --seed 7          other people, the same ponds
 *   pnpm demo:population -- --remove          removes them and writes nobody
 *   pnpm demo:population -- --dry-run         counts per pond, nothing written
 *
 * Refuses production before it opens a connection, as the seed does. The
 * ponds come from the seed (`pnpm --filter @kuutti/db seed`), which runs first.
 * It lives with the API because the consents name the version of the wording
 * in force, which the API knows from the message catalogue.
 */
import { createPool } from "@kuutti/db";
import {
  DEMO_SEED,
  DEMO_SIZE,
  generatePopulation,
  removePopulation,
  summarise,
  writePopulation,
} from "@kuutti/db/demo";
import { CURRENT_CONSENT_VERSIONS } from "../src/identity/index.ts";

function fail(message: string, code = 1): never {
  console.error(`✖ ${message}`);
  process.exit(code);
}

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};
const numberOf = (flag: string, fallback: number): number => {
  const raw = valueAfter(flag);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) fail(`${flag} takes a whole number, not ${raw}`);
  return Number(raw);
};

const env = valueAfter("--env") ?? process.env.APP_ENV ?? "development";
if (env === "production") {
  fail(
    "refusing to write synthetic people into production: previews and local databases only (TD-19)",
    2,
  );
}
const size = numberOf("--size", DEMO_SIZE);
const seed = numberOf("--seed", DEMO_SEED);

const people = (() => {
  try {
    return generatePopulation({ size, seed });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
})();
const ponds = summarise(people);

if (args.includes("--dry-run")) {
  console.log(
    JSON.stringify({ msg: "demo population (dry run)", env, size, seed, ponds }, null, 2),
  );
  process.exit(0);
}

const url = process.env.DATABASE_URL ?? fail("DATABASE_URL is not set");
const pool = createPool({ connectionString: url, max: 1, applicationName: "kuutti-demo" });
try {
  if (args.includes("--remove")) {
    const removed = await removePopulation(pool);
    console.log(JSON.stringify({ msg: "demo population removed", env, removed }));
  } else {
    const result = await writePopulation(pool, people, CURRENT_CONSENT_VERSIONS);
    console.log(JSON.stringify({ msg: "demo population", env, size, seed, ...result }));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
