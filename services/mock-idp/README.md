# mock-idp

Local stand-in for the Telia ID Broker (Finnish Trust Network): [navikt/mock-oauth2-server](https://github.com/navikt/mock-oauth2-server), started by `docker compose` on `http://127.0.0.1:8080` with one issuer, `ftn`.

- Discovery: `http://127.0.0.1:8080/ftn/.well-known/openid-configuration`
- Any `client_id` and `client_secret` are accepted. `redirect_uri` is not validated.
- Interactive login: the authorize URL shows a form. Type a username and, in the claims box, the FTN-shaped claims you want in the ID token. Example:

```json
{
  "personal_identity_code": "010190-123A",
  "name": "Testi Henkilö",
  "birthdate": "1990-01-01",
  "acr": "urn:oid:1.2.246.517.3002.110.5",
  "amr": ["bank"]
}
```

Use only generated codes (`generateHetu` in `@kuutti/db`); never a real one, even locally (rule 1).

What it does not do, on purpose: no `private_key_jwt` client authentication, no §24 retention, no real `acr` policy. The real Telia test bed is wired on staging only, because its redirect URIs are fixed (TD-2).

`node services/mock-idp/verify.ts` runs the whole code flow against the running container and prints the claims it got back. CI runs it on every push.
