/**
 * Drives the authorization-code flow against the local mock IdP without a
 * browser and checks that the FTN-shaped claims come back in the ID token.
 *
 *   node services/mock-idp/verify.ts [issuer]   (default http://127.0.0.1:8080/ftn)
 *
 * No dependencies. Exit 1 on any mismatch.
 */
const issuer = (process.argv[2] ?? process.env.OIDC_ISSUER ?? "http://127.0.0.1:8080/ftn").replace(
  /\/$/,
  "",
);
const clientId = "kuutti-local";
const redirectUri = "http://localhost:3000/auth/callback";
// The claim names the Telia broker uses for a Finnish user (docs/vendors/telia.md,
// guide 2.6.4): the hetu and the date of birth under their OIDs, the FTN
// pre-production acr, the bank as an amr URI. A generated test code, never a real one.
const claims = {
  "urn:oid:1.2.246.21": "010190-123A",
  "urn:oid:1.3.6.1.5.5.7.9.1": "1990-01-01",
  "urn:oid:2.5.4.4": "Henkilö",
  "urn:oid:1.2.246.575.1.14": "Testi",
  "urn:oid:2.16.840.1.113730.3.1.241": "Testi Henkilö",
  acr: "http://ftn.ficora.fi/2017/loatest2",
  amr: ["https://tunnistus-pp.telia.fi/uas/saml2/names/ac/oidc.mock.1"],
};

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function waitForDiscovery(): Promise<{
  authorization_endpoint: string;
  token_endpoint: string;
}> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok)
        return (await res.json()) as { authorization_endpoint: string; token_endpoint: string };
    } catch {}
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return fail(`no discovery document at ${issuer} within 60 s`);
}

const discovery = await waitForDiscovery();
console.log(`✔ discovery: ${discovery.authorization_endpoint}`);

const state = "state-1";
const nonce = "nonce-1";
const authorize = new URL(discovery.authorization_endpoint);
authorize.search = new URLSearchParams({
  client_id: clientId,
  response_type: "code",
  redirect_uri: redirectUri,
  scope: "openid",
  state,
  nonce,
}).toString();

// Step 1: the login form (interactiveLogin). Step 2: post the form back with the claims.
const form = await fetch(authorize, { redirect: "manual" });
if (form.status !== 200) fail(`authorize did not show the login form: ${form.status}`);
const login = await fetch(authorize, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username: "testi", claims: JSON.stringify(claims) }).toString(),
});
if (login.status < 300 || login.status >= 400)
  fail(`login did not redirect: ${login.status} ${await login.text()}`);
const location = login.headers.get("location") ?? fail("login redirect has no Location");
const code = new URL(location).searchParams.get("code") ?? fail(`no code in ${location}`);
if (new URL(location).searchParams.get("state") !== state) fail("state mismatch");
console.log("✔ login accepted, code issued");

const token = await fetch(discovery.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: "unused",
  }).toString(),
});
if (!token.ok) fail(`token endpoint ${token.status}: ${await token.text()}`);
const { id_token: idToken } = (await token.json()) as { id_token?: string };
if (!idToken) fail("no id_token in the token response");
const payload = JSON.parse(
  Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
) as Record<string, unknown>;
console.log("✔ id_token received");

for (const [key, expected] of Object.entries(claims)) {
  const actual = payload[key];
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(`claim ${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
if (payload.nonce !== nonce) fail(`nonce: expected ${nonce}, got ${String(payload.nonce)}`);
if (payload.iss !== issuer) fail(`iss: expected ${issuer}, got ${String(payload.iss)}`);
console.log(
  `✔ claims present: ${Object.keys(claims).join(", ")} (iss ${payload.iss}, sub ${String(payload.sub)})`,
);
