/**
 * Returns the twelve personas of the mock bank to where they begin (#73,
 * ADR-014 §12): everybody erased through the erasure path and forgotten, then
 * the six with a history given it anew through the API's own routes.
 *
 *   pnpm demo:reset                  reset, then the histories
 *   pnpm demo:reset -- --bare        reset only: all twelve are newcomers
 *   pnpm demo:reset -- --api http://localhost:3000
 *
 * Needs the local environment running (`pnpm env:up`): the histories log in
 * at the mock bank and talk to the API. Goes ahead only in development and
 * test and only against a database server that is not a deployed one
 * (packages/db/src/seed/command.ts).
 */
import { createPool } from "@kuutti/db";
import {
  assertDemoTarget,
  DEMO_ENVIRONMENTS,
  DemoCommandError,
  describeTarget,
  PERSONA_HISTORIES,
} from "@kuutti/db/demo";
import { loadConfig } from "../src/lib/config.ts";
import { createLogger } from "../src/lib/logger.ts";
import { createMediaDeps } from "../src/media/index.ts";
import { DemoError } from "./demo/bank.ts";
import { giveHistory } from "./demo/histories.ts";
import { resetPersonas } from "./demo/reset.ts";

function fail(message: string, code = 1): never {
  console.error(`✖ ${message}`);
  process.exit(code);
}

// pnpm hands the separator through.
const args = process.argv.slice(2).filter((arg, i) => !(arg === "--" && i === 0));
let api = "http://localhost:3000";
let bare = false;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i] as string;
  if (arg === "--bare") bare = true;
  else if (arg === "--api") {
    i += 1;
    api = args[i] ?? fail("--api takes the address of the API", 2);
  } else if (arg.startsWith("--api=")) api = arg.slice("--api=".length);
  else fail(`unknown argument ${arg}: --bare and --api are all there is`, 2);
}
const apiUrl = URL.canParse(api) ? new URL(api) : fail(`--api is no address: ${api}`, 2);
// The API the histories talk to is the one on this computer, like the mock bank.
if (!["localhost", "127.0.0.1", "[::1]"].includes(apiUrl.hostname)) {
  fail(`refusing: the personas get their histories from a local API, not from ${apiUrl.host}`, 2);
}

const env = process.env.APP_ENV ?? "development";
if (env !== "development" && env !== "test") {
  fail(
    `refusing: APP_ENV is "${env}", and the personas are reset in development and test only (of ${DEMO_ENVIRONMENTS.join(", ")}, a preview has no mock bank)`,
    2,
  );
}

const config = await loadConfig();
const logger = await createLogger({ level: "warn", pretty: false });
const pool = createPool({
  connectionString: config.databaseUrl,
  max: 2,
  applicationName: "kuutti-demo-reset",
});
try {
  const target = await describeTarget(pool);
  console.log(JSON.stringify({ msg: "demo reset: target", env, api: apiUrl.origin, ...target }));
  assertDemoTarget(target, env);

  const media = createMediaDeps(config).deps;
  const now = () => new Date();
  const reset = await resetPersonas({ db: pool, logger, now, ...(media ? { media } : {}) });
  console.log(JSON.stringify({ msg: "demo reset: personas forgotten", ...reset }));

  if (!bare) {
    for (const history of PERSONA_HISTORIES) {
      const given = await giveHistory(history, { api: apiUrl.origin, fetch, now, db: pool });
      console.log(JSON.stringify({ msg: "demo reset: history", ...given }));
    }
  }
} catch (error) {
  if (error instanceof DemoCommandError || error instanceof DemoError) {
    console.error(`✖ ${error.message}`);
    process.exitCode = 2;
  } else {
    console.error(error);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
