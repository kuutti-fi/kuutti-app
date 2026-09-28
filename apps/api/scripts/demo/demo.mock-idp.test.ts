import { randomBytes } from "node:crypto";
import {
  DEMO_PERSONAS,
  OLDER_TERMS_VERSION,
  PERSONA_HISTORIES,
  personaHetu,
} from "@kuutti/db/demo";
import {
  Gender,
  OnboardingStatus,
  PreferencesUpdate,
  ProfileResponse,
  ProfileUpdate,
} from "@kuutti/schema";
import { createApp } from "../../src/app.ts";
import {
  brokerOptionsFromConfig,
  OidcBroker,
  REREGISTER_COOLDOWN_DAYS,
} from "../../src/identity/index.ts";
import {
  captureLogger,
  describe,
  expect,
  type TestContext,
  test,
  testConfig,
} from "../../src/test/harness.ts";
import {
  type BankContext,
  call,
  DemoError,
  type Fetch,
  loginAs,
  lookAtApi,
  ofThisComputer,
  whyNotTheLocalStore,
} from "./bank.ts";
import { giveHistory } from "./histories.ts";
import { resetPersonas } from "./reset.ts";

// The personas' histories and the reset (#73, ADR-014 §12), against the real
// mock bank of services/mock-idp and the API in this process, inside a
// transaction that is rolled back. Runs where the mock is up
// (`docker compose up -d`, the CI compose job) and is skipped elsewhere, like
// oidc-broker.mock-idp.test.ts.
//
// The clock is the real one, on purpose. The API under test reads the time
// itself, so a fixed instant for the bank's claims would part from it as the
// days pass: a person born "this month" is of another age next month. What
// is expected is said relative to now instead, and holds on any day.

const ISSUER = process.env.MOCK_IDP_ISSUER ?? "http://127.0.0.1:8080/ftn";
const API = "http://localhost:3000";
const DAY_MS = 24 * 60 * 60 * 1000;
const reachable = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
  signal: AbortSignal.timeout(1500),
})
  .then((r) => r.ok)
  .catch(() => false);

const persona = (key: string) => {
  const found = DEMO_PERSONAS.find((p) => p.key === key);
  if (!found) throw new Error(`no persona ${key}`);
  return found;
};

/** Whether the day is the last of its month, in UTC, as the age rule counts. */
const lastDayOfMonth = (at: Date) =>
  at.getUTCDate() === new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();

async function world(ctx: TestContext) {
  const { logger, lines } = await captureLogger();
  // The ponds the histories name: the test database has no seed.
  await ctx.client.query(
    `INSERT INTO ponds (slug, name_nominative, name_inessive) VALUES
       ('espoo', 'Espoo', 'Espoossa'), ('otaniemi', 'Otaniemi', 'Otaniemessä')
     ON CONFLICT (slug) DO NOTHING`,
  );
  const config = testConfig({
    HETU_HMAC_KEY: randomBytes(32).toString("hex"),
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: "kuutti-local",
    OIDC_REDIRECT_URI: `${API}/auth/callback`,
    OIDC_ACR_VALUES: "http://ftn.ficora.fi/2017/loatest2",
  });
  const options = brokerOptionsFromConfig(config);
  if (!options) throw new Error("no broker options from the test configuration");
  const broker = await OidcBroker.create(options);
  const app = createApp({ config, logger, db: ctx.client, broker });
  // The API is this process; the bank is the real mock.
  const route: Fetch = (input, init) => {
    const url = new URL(input);
    return url.origin === API
      ? Promise.resolve(app.request(`${url.pathname}${url.search}`, init))
      : fetch(url, init);
  };
  const bank: BankContext = { api: API, fetch: route, now: () => new Date() };
  return { app, bank, logger, lines, context: { ...bank, db: ctx.client } };
}

describe("the histories are what a person's own answers would be", () => {
  test("every one passes the contracts, and there is one for each persona with a history", () => {
    expect(PERSONA_HISTORIES.map((h) => h.key).sort()).toEqual(
      DEMO_PERSONAS.filter((p) => p.group === "history")
        .map((p) => p.key)
        .sort(),
    );
    for (const history of PERSONA_HISTORIES) {
      if (history.onboarding) {
        expect(Gender.safeParse(history.onboarding.gender).success, history.key).toBe(true);
        expect(
          PreferencesUpdate.safeParse({
            seeks: history.onboarding.seeks,
            ageWindow: history.onboarding.ageWindow,
          }).success,
          history.key,
        ).toBe(true);
      }
      if (history.profile) {
        expect(ProfileUpdate.safeParse(history.profile).success, history.key).toBe(true);
        expect(history.onboarding, `${history.key}: a profile needs an onboarding`).not.toBeNull();
      }
    }
  });
});

describe("the walk to the bank and back", () => {
  const answer = (status: number, headers: Record<string, string> = {}) =>
    new Response(null, { status, headers });

  test("sends a persona's claims to a bank on this computer and to no other", async () => {
    const asked: string[] = [];
    const context: BankContext = {
      api: API,
      now: () => new Date(),
      fetch: async (input) => {
        asked.push(String(input));
        return answer(302, {
          location: "https://tunnistus-pp.telia.fi/uas/oauth2/authorization?x",
        });
      },
    };
    await expect(loginAs(persona("aino"), context)).rejects.toThrow(
      /not the mock bank on this computer: nothing was sent/,
    );
    // The API was asked where the bank is, and nobody else was asked anything.
    expect(asked).toEqual([`${API}/auth/start?platform=ios&locale=fi`]);
  });

  test("follows the bank back to the callback and to nowhere else", async () => {
    const asked: string[] = [];
    const context: BankContext = {
      api: API,
      now: () => new Date(),
      fetch: async (input) => {
        asked.push(String(input));
        return asked.length === 1
          ? answer(302, { location: "http://127.0.0.1:8080/ftn/authorize?state=s" })
          : answer(302, { location: `${API}/account/export?x=1` });
      },
    };
    await expect(loginAs(persona("aino"), context)).rejects.toThrow(/not to \/auth\/callback/);
    expect(asked).toHaveLength(2);
  });

  test("waits as long as the rate limit asks and tries once more, not twice", async () => {
    const waited: number[] = [];
    let calls = 0;
    const context: BankContext = {
      api: API,
      now: () => new Date(),
      sleep: async (ms) => {
        waited.push(ms);
      },
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? answer(429, { "retry-after": "7" })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
    expect(await call(context, "t".repeat(43), "GET", "/profile")).toEqual({ ok: true });
    expect(waited).toEqual([7000]);

    calls = -10; // limited again and again: the second answer is the answer
    const limited: BankContext = {
      ...context,
      fetch: async () =>
        new Response(
          JSON.stringify({ error: { code: "rate_limited", message: "x", requestId: "r" } }),
          { status: 429, headers: { "retry-after": "900" } },
        ),
    };
    await expect(call(limited, "t".repeat(43), "GET", "/profile")).rejects.toThrow(
      /429 rate_limited/,
    );
    // Never longer than the limit's own window, whatever the header says.
    expect(waited).toEqual([7000, 65_000]);
  });

  test("an object store is this computer's by a loopback address or one of its own, and by no name", () => {
    const own = ["127.0.0.1", "::1", "192.168.1.20", "fe80::1c2d:3eff:fe4f:5a6b"];
    for (const address of [
      "http://127.0.0.1:9000",
      "http://localhost:9000",
      "http://[::1]:9000",
      "http://192.168.1.20:9000",
      "http://[fe80::1c2d:3eff:fe4f:5a6b]:9000",
    ]) {
      expect(ofThisComputer(new URL(address), own), address).toBe(true);
    }
    for (const address of [
      // The machine beside this one, a bucket at a provider, and names, which
      // are whatever they resolve to when the deletion is sent.
      "http://192.168.1.21:9000",
      "https://s3.eu-central-1.amazonaws.com",
      "https://kuutti-media.s3.eu-central-1.amazonaws.com",
      "http://this-computer.local:9000",
      "http://0.0.0.0:9000",
    ]) {
      expect(ofThisComputer(new URL(address), own), address).toBe(false);
    }
    expect(ofThisComputer(new URL("http://192.168.1.20:9000"), [])).toBe(false);
  });

  test("the object store is the stand-in by its address, its addressing and its bucket, all three", () => {
    const own = ["127.0.0.1", "192.168.1.20"];
    const standIn = { endpoint: "http://127.0.0.1:9000", bucket: "kuutti-media", pathStyle: true };
    expect(whyNotTheLocalStore(standIn, own)).toBeNull();
    expect(whyNotTheLocalStore({ ...standIn, endpoint: "http://localhost:9000" }, own)).toBeNull();
    expect(
      whyNotTheLocalStore({ ...standIn, endpoint: "http://192.168.1.20:9000" }, own),
    ).toBeNull();

    expect(
      whyNotTheLocalStore({ ...standIn, endpoint: "https://s3.eu-central-1.amazonaws.com" }, own),
    ).toMatch(/it is at s3\.eu-central-1\.amazonaws\.com, not on this computer/);
    expect(whyNotTheLocalStore({ ...standIn, endpoint: "127.0.0.1:9000" }, own)).toMatch(
      /not on this computer|no address/,
    );
    expect(whyNotTheLocalStore({ ...standIn, endpoint: "somewhere" }, own)).toBe(
      "S3_ENDPOINT is no address",
    );
    // Without path style the client dials <bucket>.localhost, a name that is looked up.
    expect(
      whyNotTheLocalStore({ ...standIn, endpoint: "http://localhost:9000", pathStyle: false }, own),
    ).toMatch(/S3_FORCE_PATH_STYLE is not true/);
    // A bucket given as an ARN names its own endpoint, whatever S3_ENDPOINT says.
    expect(
      whyNotTheLocalStore(
        { ...standIn, bucket: "arn:aws:s3::123456789012:accesspoint/kuutti.mrap" },
        own,
      ),
    ).toMatch(/S3_BUCKET is an ARN/);
  });

  const healthy = {
    status: "ok",
    version: "0.0.0",
    commit: "abc1234",
    builtAt: "2026-09-01T09:00:00.000Z",
    source: "https://github.com/kuutti-fi/kuutti-app",
    db: "ok",
    migrations: "current",
  };
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });
  const asking = (fetch: Fetch): BankContext => ({ api: API, now: () => new Date(), fetch });

  test("the API is asked what it is before anybody is erased: nobody there, somebody else, not ready", async () => {
    await expect(
      lookAtApi(
        asking(async () => {
          throw new TypeError("fetch failed");
        }),
      ),
    ).rejects.toThrow(/nothing answers at/);
    await expect(
      lookAtApi(asking(async () => new Response("<html></html>", { status: 200 }))),
    ).rejects.toThrow(/is not Kuutti's API/);
    await expect(lookAtApi(asking(async () => json({ status: "ok" }, 200)))).rejects.toThrow(
      /is not Kuutti's API/,
    );
    await expect(
      lookAtApi(
        asking(async () => json({ ...healthy, status: "degraded", migrations: "pending" }, 503)),
      ),
    ).rejects.toThrow(/is not ready: database ok, migrations pending/);
  });

  test("an API whose bank is somewhere else is refused, and one whose bank is here is said", async () => {
    const asked: string[] = [];
    const to = (bank: string) =>
      asking(async (input) => {
        asked.push(String(input));
        return String(input).endsWith("/health")
          ? json(healthy, 200)
          : answer(302, { location: bank });
      });
    await expect(
      lookAtApi(to("https://tunnistus-pp.telia.fi/uas/oauth2/authorization?x")),
    ).rejects.toThrow(/not the mock bank on this computer/);
    expect(await lookAtApi(to("http://127.0.0.1:8080/ftn/authorize?state=s"))).toEqual({
      commit: "abc1234",
      bank: "http://127.0.0.1:8080",
    });
    // Two questions each time, and nothing posted to anybody.
    const questions = [`${API}/health`, `${API}/auth/start?platform=ios&locale=fi`];
    expect(asked).toEqual([...questions, ...questions]);
  });

  test("an API that sends the question of its health elsewhere is not followed there", async () => {
    const asked: { url: string; redirect: string | undefined }[] = [];
    const sending = asking(async (input, init) => {
      asked.push({ url: String(input), redirect: init?.redirect });
      return answer(302, { location: "https://api.staging.kuutti.app/health" });
    });
    await expect(lookAtApi(sending)).rejects.toThrow(/is not Kuutti's API/);
    expect(asked).toEqual([{ url: `${API}/health`, redirect: "manual" }]);
  });
});

describe.skipIf(!reachable)("the personas, through the mock bank", () => {
  test("the API of this repository, with the mock bank, is one the reset goes on with", async ({
    ctx,
  }) => {
    const { bank } = await world(ctx);
    expect(await lookAtApi(bank)).toMatchObject({ bank: new URL(ISSUER).origin });
  });

  test("a newcomer logs in with one posted form and is a fresh account", async ({ ctx }) => {
    const { bank } = await world(ctx);
    const first = await loginAs(persona("aino"), bank);
    expect(first).toMatchObject({ kind: "session", outcome: "created" });
    // The same person again: the same account.
    expect(await loginAs(persona("aino"), bank)).toMatchObject({ outcome: "resumed" });
    const { rows } = await ctx.client.query<{ birth_year: number; birth_month: number }>(
      `SELECT a.birth_year, a.birth_month FROM account a JOIN identity i ON i.id = a.identity_id
       WHERE i.broker_subject = 'aino'`,
    );
    expect(rows).toEqual([{ birth_year: 1997, birth_month: 3 }]);
  });

  test("the ages are let in and refused by the product's own rule, on whatever day this runs", async ({
    ctx,
  }) => {
    const { bank } = await world(ctx);
    expect(await loginAs(persona("eetu"), bank)).toMatchObject({ kind: "session" });
    expect(await loginAs(persona("helmi"), bank)).toMatchObject({ kind: "session" });
    expect(await loginAs(persona("lauri"), bank)).toEqual({
      kind: "refused",
      error: "auth_under_18",
      until: null,
    });
    // She turns 18 this month: refused on every day of it but the last, when
    // the rule counts her birthday. Asked before and after, for a run across
    // midnight.
    const before = lastDayOfMonth(new Date());
    const venla = await loginAs(persona("venla"), bank);
    const after = lastDayOfMonth(new Date());
    if (before === after) {
      expect(venla).toMatchObject(
        before ? { kind: "session" } : { kind: "refused", error: "auth_under_18" },
      );
    }
  });

  test("the six histories leave each persona where the mock bank's page says", async ({ ctx }) => {
    const { bank, context, lines } = await world(ctx);
    const began = Date.now();
    for (const history of PERSONA_HISTORIES) {
      expect(await giveHistory(history, context)).toMatchObject({ key: history.key });
    }
    const ended = Date.now();

    const as = async (key: string) => {
      const login = await loginAs(persona(key), bank);
      if (login.kind !== "session") throw new Error(`${key} is refused: ${login.error}`);
      const onboarding = OnboardingStatus.parse(
        await call(bank, login.accessToken, "GET", "/onboarding"),
      );
      const profile = ProfileResponse.parse(await call(bank, login.accessToken, "GET", "/profile"));
      return { login, onboarding, profile };
    };
    const stateOf = async (key: string) =>
      (
        await ctx.client.query<{ state: string }>(
          `SELECT a.state FROM account a JOIN identity i ON i.id = a.identity_id
           WHERE i.broker_subject = $1`,
          [key],
        )
      ).rows.map((r) => r.state);

    // Active before anybody looked: the history itself made them so.
    expect(await stateOf("sanna")).toEqual(["active"]);
    expect(await stateOf("noa")).toEqual(["active"]);
    expect(await stateOf("kerttu")).toEqual(["active"]);
    expect(await stateOf("onni")).toEqual(["registered"]);
    expect(await stateOf("tapio")).toEqual(["banned"]);
    expect(await stateOf("ilona")).toEqual(["deleted"]);

    const sanna = await as("sanna");
    expect(sanna.login.outcome).toBe("resumed");
    expect(sanna.onboarding.missing).toEqual([]);
    expect(sanna.profile.profile?.displayName).toBe("Sanna");
    // Everything but the photos, which the photo loader brings.
    expect(sanna.profile.completeness.missing).toEqual(["photos"]);

    expect((await as("onni")).onboarding.missing).toEqual([
      "gender",
      "seeks",
      "age_window",
      "pond",
      "terms",
      "privacy",
    ]);
    expect((await as("noa")).onboarding.gender).toBe("non_binary");

    // The wording moved on: an active account that is asked for the terms again, and only for them.
    const kerttu = await as("kerttu");
    expect(kerttu.onboarding).toMatchObject({ state: "active", missing: ["terms"] });
    const { rows: older } = await ctx.client.query<{ version: string }>(
      `SELECT c.version FROM consent c JOIN account a ON a.id = c.account_id
       JOIN identity i ON i.id = a.identity_id WHERE i.broker_subject = 'kerttu' AND c.kind = 'terms'`,
    );
    expect(older).toEqual([{ version: OLDER_TERMS_VERSION }]);

    expect(await loginAs(persona("tapio"), bank)).toEqual({
      kind: "refused",
      error: "auth_banned",
      until: null,
    });
    const ilona = await loginAs(persona("ilona"), bank);
    expect(ilona).toMatchObject({ kind: "refused", error: "auth_cooldown" });
    // The waiting time, counted from when she deleted her account.
    const until = Date.parse((ilona.kind === "refused" && ilona.until) || "");
    expect(until).toBeGreaterThanOrEqual(began + REREGISTER_COOLDOWN_DAYS * DAY_MS - 1000);
    expect(until).toBeLessThanOrEqual(ended + REREGISTER_COOLDOWN_DAYS * DAY_MS + 1000);

    // Nothing of a persona's bank claims is in a log line: no code, no name.
    // The codes themselves, not a pattern: a request id can look like one.
    const logged = JSON.stringify(lines());
    expect(lines().length).toBeGreaterThan(20);
    for (const p of DEMO_PERSONAS) {
      expect(logged).not.toContain(p.family);
      for (const at of [began, ended]) expect(logged).not.toContain(personaHetu(p, new Date(at)));
    }
  });

  test("a history says so when the API serves another database than the command's", async ({
    ctx,
  }) => {
    const { context } = await world(ctx);
    const kerttu = PERSONA_HISTORIES.find((h) => h.key === "kerttu");
    if (!kerttu) throw new Error("no history of kerttu");
    // The statements go where nothing of the persona is: they meet no row.
    const elsewhere = { query: async () => ({ rows: [], rowCount: 0 }) };
    await expect(
      giveHistory(kerttu, { ...context, db: elsewhere as unknown as typeof context.db }),
    ).rejects.toThrow(DemoError);
  });

  test("the reset forgets every persona through the erasure path, and nobody else", async ({
    ctx,
  }) => {
    const { bank, context, logger } = await world(ctx);
    const now = () => new Date();
    for (const history of PERSONA_HISTORIES) await giveHistory(history, context);
    await loginAs(persona("aino"), bank);
    // Somebody who is no persona, at the same bank.
    const other = await loginAs({ ...persona("mikael"), key: "somebody", individual: 950 }, bank);
    expect(other).toMatchObject({ kind: "session", outcome: "created" });
    // And a persona's name at another bank: not ours to forget.
    await ctx.client.query(
      `INSERT INTO identity (hetu_hmac, broker_subject, acr, amr)
       VALUES ('not-the-mock-bank', 'aino', 'x', ARRAY['https://another.bank/method'])`,
    );

    const count = async (sql: string) =>
      Number((await ctx.client.query<{ n: string }>(sql)).rows[0]?.n);
    const personas = `broker_subject = ANY(ARRAY[${DEMO_PERSONAS.map((p) => `'${p.key}'`).join(",")}])`;
    expect(await count(`SELECT count(*) AS n FROM identity WHERE ${personas}`)).toBe(8);

    const result = await resetPersonas({ db: ctx.client, logger, now });
    // Seven identities of the mock bank; six accounts were live (Ilona's was a tombstone
    // already, Tapio's was banned and is taken as it is).
    expect(result).toEqual({ identities: 7, erased: 6, objects: 0, spared: [] });
    expect(await count(`SELECT count(*) AS n FROM identity WHERE ${personas}`)).toBe(1);
    expect(
      await count(
        `SELECT count(*) AS n FROM account a JOIN identity i ON i.id = a.identity_id WHERE i.${personas}`,
      ),
    ).toBe(0);
    expect(
      await count("SELECT count(*) AS n FROM identity WHERE broker_subject = 'somebody'"),
    ).toBe(1);

    // Everybody is a newcomer again, the banned and the deleted included.
    for (const key of ["sanna", "tapio", "ilona", "aino"]) {
      expect(await loginAs(persona(key), bank), key).toMatchObject({
        kind: "session",
        outcome: "created",
      });
    }
    expect(await resetPersonas({ db: ctx.client, logger, now })).toMatchObject({
      identities: 4,
      erased: 4,
    });
  });

  test("a persona that was made a moderator is left alone, whole, and the others are reset", async ({
    ctx,
  }) => {
    const { bank, logger } = await world(ctx);
    const now = () => new Date();
    await loginAs(persona("aino"), bank);
    await loginAs(persona("mikael"), bank);
    // As the moderator's command line grants a role: to the identity that just logged in.
    await ctx.client.query(
      `INSERT INTO moderator_roles (identity_id, role, granted_by)
       SELECT id, 'moderator', 'test' FROM identity WHERE broker_subject = 'aino'`,
    );

    const result = await resetPersonas({ db: ctx.client, logger, now });
    expect(result).toEqual({ identities: 1, erased: 1, objects: 0, spared: ["aino"] });
    // Not erased and then stuck: her account is as it was, and she is who she was.
    expect(await loginAs(persona("aino"), bank)).toMatchObject({ outcome: "resumed" });
    expect(await loginAs(persona("mikael"), bank)).toMatchObject({ outcome: "created" });
    // And again, as often as it is run.
    expect(await resetPersonas({ db: ctx.client, logger, now })).toMatchObject({
      erased: 1,
      spared: ["aino"],
    });
    expect(await loginAs(persona("aino"), bank)).toMatchObject({ outcome: "resumed" });
  });

  test("a persona whose role was taken away is reset at once, its ended staff sessions with it", async ({
    ctx,
  }) => {
    const { bank, logger } = await world(ctx);
    const now = () => new Date();
    await loginAs(persona("aino"), bank);
    await loginAs(persona("mikael"), bank);
    // Both were moderators and had signed in to the panel. Aino's role was
    // taken away as the command line does it: the role's row deleted, the
    // session marked revoked and left to the nightly sweep; an older session
    // of hers ran out. Mikael's role went by hand, and his session is live.
    await ctx.client.query(
      `INSERT INTO admin_session (identity_id, role, access_hash, expires_at, revoked_at)
       SELECT id, 'moderator', 'hash of ' || broker_subject, now() + interval '8 hours',
              CASE WHEN broker_subject = 'aino' THEN now() END
       FROM identity WHERE broker_subject IN ('aino', 'mikael')`,
    );
    await ctx.client.query(
      `INSERT INTO admin_session (identity_id, role, access_hash, expires_at)
       SELECT id, 'moderator', 'hash of an older one', now() - interval '1 hour'
       FROM identity WHERE broker_subject = 'aino'`,
    );

    const result = await resetPersonas({ db: ctx.client, logger, now });
    expect(result).toEqual({ identities: 1, erased: 1, objects: 0, spared: ["mikael"] });
    const { rows } = await ctx.client.query<{ key: string }>(
      `SELECT i.broker_subject AS key FROM admin_session s JOIN identity i ON i.id = s.identity_id`,
    );
    expect(rows).toEqual([{ key: "mikael" }]);
    expect(await loginAs(persona("aino"), bank)).toMatchObject({ outcome: "created" });
    expect(await loginAs(persona("mikael"), bank)).toMatchObject({ outcome: "resumed" });
  });
});
