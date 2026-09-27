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
import { brokerOptionsFromConfig, OidcBroker } from "../../src/identity/index.ts";
import {
  captureLogger,
  describe,
  expect,
  type TestContext,
  test,
  testConfig,
} from "../../src/test/harness.ts";
import { type BankContext, call, type Fetch, loginAs } from "./bank.ts";
import { giveHistory } from "./histories.ts";
import { resetPersonas } from "./reset.ts";

// The personas' histories and the reset (#73, ADR-014 §12), against the real
// mock bank of services/mock-idp and the API in this process, inside a
// transaction that is rolled back. Runs where the mock is up
// (`docker compose up -d`, the CI compose job) and is skipped elsewhere, like
// oidc-broker.mock-idp.test.ts.

const ISSUER = process.env.MOCK_IDP_ISSUER ?? "http://127.0.0.1:8080/ftn";
const API = "http://localhost:3000";
const NOW = new Date("2026-09-27T12:00:00Z");
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
  const bank: BankContext = { api: API, fetch: route, now: () => NOW };
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

describe.skipIf(!reachable)("the personas, through the mock bank", () => {
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

  test("the ages are let in and refused by the product's own rule", async ({ ctx }) => {
    const { bank } = await world(ctx);
    expect(await loginAs(persona("eetu"), bank)).toMatchObject({ kind: "session" });
    expect(await loginAs(persona("helmi"), bank)).toMatchObject({ kind: "session" });
    expect(await loginAs(persona("lauri"), bank)).toEqual({
      kind: "refused",
      error: "auth_under_18",
      until: null,
    });
    // NOW is the 27th of a month of thirty days: she is 17 until its last day.
    expect(await loginAs(persona("venla"), bank)).toMatchObject({ error: "auth_under_18" });
  });

  test("the six histories leave each persona where the mock bank's page says", async ({ ctx }) => {
    const { bank, context, lines } = await world(ctx);
    for (const history of PERSONA_HISTORIES) {
      expect(await giveHistory(history, context)).toMatchObject({ key: history.key });
    }

    const as = async (key: string) => {
      const login = await loginAs(persona(key), bank);
      if (login.kind !== "session") throw new Error(`${key} is refused: ${login.error}`);
      const onboarding = OnboardingStatus.parse(
        await call(bank, login.accessToken, "GET", "/onboarding"),
      );
      const profile = ProfileResponse.parse(await call(bank, login.accessToken, "GET", "/profile"));
      return { login, onboarding, profile };
    };

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

    // The wording moved on: the app asks for the terms again, and only for them.
    expect((await as("kerttu")).onboarding.missing).toEqual(["terms"]);
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
    expect(ilona.kind === "refused" && ilona.until).toMatch(/^2026-10-2\d/);

    // Nothing of a persona's bank claims is in a log line: no code, no name.
    // The codes themselves, not a pattern: a request id can look like one.
    const logged = JSON.stringify(lines());
    expect(lines().length).toBeGreaterThan(20);
    for (const p of DEMO_PERSONAS) {
      expect(logged).not.toContain(p.family);
      expect(logged).not.toContain(personaHetu(p, NOW));
    }
  });

  test("the reset forgets every persona through the erasure path, and nobody else", async ({
    ctx,
  }) => {
    const { bank, context, logger } = await world(ctx);
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

    const result = await resetPersonas({ db: ctx.client, logger, now: () => NOW });
    // Seven identities of the mock bank; six accounts were live (Ilona's was a tombstone
    // already, Tapio's was banned and is taken like any other).
    expect(result).toMatchObject({ identities: 7, erased: 6 });
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
    expect(await resetPersonas({ db: ctx.client, logger, now: () => NOW })).toMatchObject({
      identities: 4,
      erased: 4,
    });
  });
});
