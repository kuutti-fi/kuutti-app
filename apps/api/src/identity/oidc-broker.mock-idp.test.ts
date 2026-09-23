import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OidcBroker } from "./oidc-broker.ts";

// The plain dialect against the real mock IdP of services/mock-idp (navikt
// mock-oauth2-server, docker compose): discovery over http, no request object,
// no client authentication, a signed but unencrypted ID token. Runs where the
// mock is up (`docker compose up -d`, the CI compose job) and is skipped
// elsewhere, so the suite never depends on Docker.

const ISSUER = process.env.MOCK_IDP_ISSUER ?? "http://127.0.0.1:8080/ftn";
const LOATEST2 = "http://ftn.ficora.fi/2017/loatest2";
const reachable = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
  signal: AbortSignal.timeout(1500),
})
  .then((r) => r.ok)
  .catch(() => false);

describe.skipIf(!reachable)("OidcBroker against the mock IdP", () => {
  it("completes a login with the claims the login form posted, and refuses another acr", async () => {
    const broker = await OidcBroker.create({
      issuer: ISSUER,
      clientId: "kuutti-local",
      redirectUri: "http://localhost:3000/auth/callback",
      acrValues: LOATEST2,
      signingKeyPem: null,
      encryptionKeyPem: null,
    });
    const run = async (acr: string) => {
      const state = randomBytes(24).toString("base64url");
      const nonce = randomBytes(24).toString("base64url");
      const url = await broker.startLogin({ state, nonce, locale: "fi" });
      // interactiveLogin: the authorize URL serves a form; posting it back with
      // the claims is what the person's browser does (services/mock-idp/verify.ts).
      const form = await fetch(url, { redirect: "manual" });
      expect(form.status).toBe(200);
      const cookie = form.headers.get("set-cookie")?.split(";")[0];
      const posted = await fetch(url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(cookie ? { cookie } : {}),
        },
        body: new URLSearchParams({
          username: "testi",
          claims: JSON.stringify({
            "urn:oid:1.2.246.21": "220750-999Y",
            acr,
            amr: ["https://tunnistus-pp.telia.fi/uas/saml2/names/ac/oidc.mock.1"],
            session_index: "_mock",
          }),
        }).toString(),
      });
      expect(posted.status).toBeGreaterThanOrEqual(300);
      const back = new URL(posted.headers.get("location") ?? "");
      expect(back.searchParams.get("state")).toBe(state);
      return broker.completeLogin({ callbackUrl: back, state, nonce });
    };
    const answer = await run(LOATEST2);
    expect(answer.hetu).toBe("220750-999Y");
    expect(answer.acr).toBe(LOATEST2);
    expect(answer.sessionIndex).toBe("_mock");
    await expect(run("mpki.telia.emulator.1")).rejects.toMatchObject({
      detail: { detail: "unexpected acr" },
    });
  });
});
