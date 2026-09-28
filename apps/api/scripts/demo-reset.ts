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
 * at the mock bank and talk to the API. Everything it touches is on this
 * computer, and it looks before it acts: development or test, an API and a
 * bank on a loopback address, configuration from this process alone (never
 * from a parameter store), no proxy, a database server that is not a
 * deployed one, an object store at an address of this computer (or none,
 * while no persona has a photo), and, where histories are to be given, an
 * API that answers as ours, from this database, before anybody is erased.
 */
import { networkInterfaces } from "node:os";
import { createPool } from "@kuutti/db";
import {
  assertDemoTarget,
  DemoCommandError,
  describeTarget,
  PERSONA_HISTORIES,
} from "@kuutti/db/demo";
import { takeSnapshot } from "../src/jobs/waitlist-snapshot.ts";
import { parseConfig } from "../src/lib/config.ts";
import { createLogger } from "../src/lib/logger.ts";
import { createMediaDeps } from "../src/media/index.ts";
import { DemoError, lookAtApi, onThisComputer, whyNotTheLocalStore } from "./demo/bank.ts";
import { giveHistory } from "./demo/histories.ts";
import { resetPersonas } from "./demo/reset.ts";

function fail(message: string, code = 2): never {
  console.error(`✖ ${message}`);
  process.exit(code);
}

// pnpm hands the separator through.
const args = process.argv.slice(2).filter((arg, i) => !(arg === "--" && i === 0));
let api = "http://localhost:3000";
let bare = false;
const seen = new Set<string>();
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i] as string;
  const flag = arg.startsWith("--api=") ? "--api" : arg;
  if (seen.has(flag)) fail(`${flag} is given twice`);
  seen.add(flag);
  if (arg === "--bare") bare = true;
  else if (arg === "--api") {
    i += 1;
    api = args[i] ?? fail("--api takes the address of the API");
  } else if (arg.startsWith("--api=")) api = arg.slice("--api=".length);
  else fail(`unknown argument ${arg}: --bare and --api are all there is`);
}
const apiUrl = URL.canParse(api) ? new URL(api) : fail(`--api is no address: ${api}`);
if (!onThisComputer(apiUrl)) {
  fail(`refusing: the personas get their histories from a local API, not from ${apiUrl.host}`);
}

// Node sends fetch through a proxy when it is told to, loopback addresses
// included unless NO_PROXY names them: a persona's claims and a session's
// token would then pass through somebody else.
if (process.env.NODE_USE_ENV_PROXY) {
  fail("refusing: NODE_USE_ENV_PROXY is set, and nothing of this goes through a proxy; unset it");
}

const env = process.env.APP_ENV ?? "development";
if (env !== "development" && env !== "test") {
  fail(
    `refusing: APP_ENV is "${env}", and the personas are reset in development and test only: nothing else has a mock bank`,
  );
}

// From this process's environment and nothing else: `loadConfig` would read a
// parameter store when a prefix is set, and a deployed environment's
// configuration has no business here.
const config = parseConfig({ ...process.env, SSM_PARAMETER_PREFIX: undefined });
const issuer = config.OIDC_ISSUER && URL.canParse(config.OIDC_ISSUER) ? config.OIDC_ISSUER : null;
if (!issuer || !onThisComputer(new URL(issuer))) {
  fail(
    `refusing: the bank of this configuration is ${issuer ? new URL(issuer).host : "not set"}, not the mock bank on this computer`,
  );
}
// Erasure deletes a photo's objects. The local stand-in's, or nobody's: a
// bucket behind a distribution is a deployed one, and an endpoint is any
// address somebody wrote into the configuration, so the store is asked where
// it is: on this computer, by a loopback address or by one of the computer's
// own (a phone on the network reaches the stand-in by that one, env.example),
// addressed by path, in a bucket that is a name.
const media = createMediaDeps(config);
if (media.setup.mode === "cloudfront") {
  fail("refusing: the object store of this configuration is a deployed one");
}
if (media.setup.mode === "presigned") {
  const own = Object.values(networkInterfaces()).flatMap((list) =>
    (list ?? []).map((a) => a.address),
  );
  const why = whyNotTheLocalStore(
    {
      endpoint: media.setup.endpoint,
      bucket: media.setup.bucket,
      pathStyle: config.S3_FORCE_PATH_STYLE,
    },
    own,
  );
  if (why) {
    fail(
      `refusing: the object store of this configuration is not the stand-in on this computer: ${why}`,
    );
  }
}
const store = media.setup.mode === "presigned" ? media.deps : undefined;

const logger = await createLogger({ level: "warn", pretty: false });
const pool = createPool({
  connectionString: config.databaseUrl,
  max: 2,
  applicationName: "kuutti-demo-reset",
});
try {
  const target = await describeTarget(pool);
  console.log(
    JSON.stringify({
      msg: "demo reset: target",
      env,
      api: apiUrl.origin,
      bank: new URL(issuer).origin,
      objects: media.setup.mode,
      ...target,
    }),
  );
  assertDemoTarget(target, env);

  const now = () => new Date();
  // Before anybody is erased: an API that is not there, or not ours, or not
  // ready, or of another database than this one, would leave the six
  // without the history they were erased for.
  if (!bare) {
    const looked = await lookAtApi({ api: apiUrl.origin, fetch, now, db: pool });
    console.log(JSON.stringify({ msg: "demo reset: the API", api: apiUrl.origin, ...looked }));
  }
  const reset = await resetPersonas({ db: pool, logger, now, ...(store ? { media: store } : {}) });
  console.log(JSON.stringify({ msg: "demo reset: personas forgotten", ...reset }));

  if (!bare) {
    for (const history of PERSONA_HISTORIES) {
      if (reset.spared.includes(history.key)) continue;
      const given = await giveHistory(history, { api: apiUrl.origin, fetch, now, db: pool });
      console.log(JSON.stringify({ msg: "demo reset: history", ...given }));
    }
  }
  // The ponds have other people in them now: the counter of #54 is counted
  // anew, as after a write of the population (demo-population.ts says why).
  await pool.query("DELETE FROM waitlist_snapshot");
  const counted = await takeSnapshot({ db: pool, logger, now });
  console.log(JSON.stringify({ msg: "demo reset: counter recounted", ...counted }));

  if (reset.spared.length > 0) {
    throw new DemoError(
      `left alone, because they hold a staff row on this machine: ${reset.spared.join(", ")}. Take the role away (pnpm --filter @kuutti/db moderator -- revoke), which ends the staff sessions too, and reset again; a persona that has looked at a photo or decided on one as a moderator is in the audit log and stays until the database is made anew`,
    );
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
