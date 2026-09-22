# mock-idp

Local stand-in for the Telia ID Broker (Finnish Trust Network): [navikt/mock-oauth2-server](https://github.com/navikt/mock-oauth2-server), started by `docker compose` on `http://127.0.0.1:8080` with one issuer, `ftn`.

- Discovery: `http://127.0.0.1:8080/ftn/.well-known/openid-configuration`
- Any `client_id` and `client_secret` are accepted. `redirect_uri` is not validated.
- Interactive login: the authorize URL shows a form. Type a username and, in the claims box, the FTN-shaped claims you want in the ID token. Example:

```json
{
  "urn:oid:1.2.246.21": "010190-123A",
  "urn:oid:1.3.6.1.5.5.7.9.1": "1990-01-01",
  "urn:oid:2.5.4.4": "Henkilö",
  "urn:oid:1.2.246.575.1.14": "Testi",
  "urn:oid:2.16.840.1.113730.3.1.241": "Testi Henkilö",
  "acr": "http://ftn.ficora.fi/2017/loatest2",
  "amr": ["https://tunnistus-pp.telia.fi/uas/saml2/names/ac/oidc.mock.1"]
}
```

These are the claim names and shapes the real broker uses (`docs/vendors/telia.md`, guide section 2.6.4): the hetu under `urn:oid:1.2.246.21`, the date of birth under `urn:oid:1.3.6.1.5.5.7.9.1`, the FTN pre-production `acr`, the bank as an `amr` URI. The container adds `acr` and `amr` itself (`config.json`), so the form needs only the person.

Use only generated codes (`generateHetu` in `@kuutti/db`); never a real one, even locally (rule 1).

What it does not do, on purpose: no signed request object, no `private_key_jwt` client authentication, no encrypted ID token, no §24 retention, no real `acr` policy. The real Telia test bed is wired on staging only, because its redirect URIs are fixed (TD-2).

`node services/mock-idp/verify.ts` runs the whole code flow against the running container and prints the claims it got back. CI runs it on every push.
