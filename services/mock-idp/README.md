# mock-idp

Local stand-in for the Telia ID Broker (Finnish Trust Network): [navikt/mock-oauth2-server](https://github.com/navikt/mock-oauth2-server), started by `docker compose` on `http://127.0.0.1:8080` with one issuer, `ftn`.

- Discovery: `http://127.0.0.1:8080/ftn/.well-known/openid-configuration`
- Any `client_id` and `client_secret` are accepted. `redirect_uri` is not validated.
- The login page is ours (`login.html`, `loginPagePath` in `config.json`): a button for each of the twelve personas and, below them, a form for anybody else.

## The personas

One tap logs a persona in. Nothing in the API or the app knows about them: the bank says who the person is, and the whole product path runs as for anybody (the OIDC exchange, the parsing of the code, the HMAC, the age rule, the re-registration rule). ADR-014 says why the shortcut lives here and nowhere else.

| persona | born | what it is for |
|---|---|---|
| Aino Virtanen | 14/03/1997 | the walkthrough: registers, onboards, fills in a profile, uploads photos |
| Mikael Lindqvist | 02/08/1992 | a second newcomer, for the walkthrough in Swedish |
| Sanna Korhonen | 23/11/1989 | onboarded, with a complete profile |
| Onni Mäkelä | 30/05/1995 | registered and never onboarded |
| Noa Salmi | 09/01/1999 | two photos only: the profile says what is missing |
| Kerttu Åkerlund | 17/06/1985 | accepted an older wording of the terms: the app asks again |
| Tapio Heikkinen | 05/02/1978 | a banned identity: the login is refused |
| Ilona Öhman | 27/09/1993 | deleted her account: refused until the waiting time is over |
| Eetu Laine | the 1st of last month, 18 years ago | the youngest who gets in |
| Venla Nieminen | the 1st of this month, 18 years ago | refused until the last day of the month: age is counted from the end of the birth month (TD-14) |
| Lauri Hämäläinen | the 1st of last month, 17 years ago | refused |
| Helmi Koskinen | the 1st of last month, 99 years ago | the upper end of the age window |

The first eight are the same identity on every day. What Kuutti holds about the six "with a history" is given by `pnpm demo:reset`; before it has run they are newcomers like Aino and Mikael. The last four are born relative to today, so their age holds whenever this runs and their identity changes as the months pass; they carry no history.

## Resetting

```bash
pnpm demo:reset
```

Returns all twelve to where they begin, in a couple of seconds, with the local environment running (`pnpm env:up`). First every persona is forgotten: each live account goes through the erasure path, the function behind "delete my account", and then what erasure keeps of a person (the tombstone, the consents, the identity with its waiting time) is deleted too, which is right for a persona and never done for a person. Then the six histories are given anew: the command logs each persona in at this mock bank and sends the answers of onboarding and the profile through the API's own routes, as the app does. What no route does is done in the database afterwards: Kerttu's consent is given the version of an older wording, and Tapio's identity is banned. Ilona deletes her account herself.

`pnpm demo:reset -- --bare` forgets everybody and gives no history. The command talks to a local API only, goes ahead in development and test only, and refuses a database server that is a deployed one, whatever the environment is called. The histories are data in `packages/db/src/seed/histories.ts`.

Their personal identity codes are artificial: the individual number is in 900 to 999, which the population register does not give to a person. The page computes a code when its button is pressed, and the generator refuses a persona with any other number.

The source is `packages/db/src/seed/personas.ts`. After a change there, `pnpm demo:bank` writes `login.html`, which is committed (docker compose mounts it, and a clean checkout must start); a test in `packages/db` fails when the two disagree, and another runs the page's script against `personaClaims` for every persona on a range of days. The container reads the page at every login, so a new page needs no restart, a switch of branches included (docker compose mounts this directory, not single files); a change of `config.json` does (`docker compose restart mock-idp`).

## Somebody else

The form under the personas posts a name and, in the claims box, the FTN-shaped claims for the ID token. It starts with:

```json
{
  "urn:oid:1.2.246.21": "010190-999W",
  "urn:oid:1.3.6.1.5.5.7.9.1": "1990-01-01",
  "urn:oid:2.5.4.4": "Henkilö",
  "urn:oid:1.2.246.575.1.14": "Testi",
  "urn:oid:2.16.840.1.113730.3.1.241": "Testi Henkilö",
  "acr": "http://ftn.ficora.fi/2017/loatest2",
  "amr": ["https://tunnistus-pp.telia.fi/uas/saml2/names/ac/oidc.mock.1"]
}
```

These are the claim names and shapes the real broker uses (`docs/vendors/telia.md`, guide section 2.6.4): the hetu under `urn:oid:1.2.246.21`, the date of birth under `urn:oid:1.3.6.1.5.5.7.9.1`, the FTN pre-production `acr`, the bank as an `amr` URI. The server adds none of them: what is posted is what the token says, and a login without `acr` is refused by the API, as it should be. (A `requestMappings` entry on `scope` used to be here to add `acr` and `amr`; it never did for a login through the form.)

Type artificial codes only, with an individual number of 900 to 999; never a real one, even locally (rule 1). A code from `generateHetu` is well-formed and in the range people hold, so it belongs in seeds and tests, not here.

## What it does not do

On purpose: no signed request object, no `private_key_jwt` client authentication, no encrypted ID token, no §24 retention, no real `acr` policy. The real Telia test bed is wired on staging only, because its redirect URIs are fixed (TD-2). The mock runs on a developer's machine and in CI's compose job, nowhere else. Staging and production identify through Telia. A preview may never use the real broker (`docs/vendors/telia.md`) and has no mock deployed beside it today, so bank identification is off there. A mock bank on a public host would let anybody be anybody; deploying one is a decision of its own (ADR-014).

## Checking it

`node services/mock-idp/verify.ts` runs the whole code flow against the running container: the login page names every persona, each persona's claims come back in the ID token as posted (names with å, ä and ö included), and so do the claims of somebody else. CI runs it on every push.
