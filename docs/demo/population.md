# The synthetic population

Data dictionary of `pnpm demo:population` (#73, ADR-014 §8 to §10). The population is never stored: `generatePopulation` in `packages/db/src/seed/population.ts` makes it from a seed, a size and an epoch, and the numbers below are what it makes at the defaults (size 300, seed 73, epoch 01/10/2026). Change a number there and here in the same change; the tests hold the thresholds.

## Commands

```bash
pnpm demo:population
```

Writes three hundred people into the database of the local environment, replacing the synthetic population that was there. The ponds come from the seed, which `pnpm env:up` has run.

| option | what it does |
|---|---|
| `-- --size 5000` | as many people as asked, 1 to 5,000; the small pond stays at 24 |
| `-- --seed 7` | other people in the same ponds |
| `-- --dry-run` | prints the counts per pond and writes nothing |
| `-- --remove` | removes the synthetic population and writes nobody |
| `-- --env production` | refused, as is `APP_ENV=production` |

## Who lives where, and why

| pond | people | women | men | non-binary | why |
|---|---|---|---|---|---|
| Pääkaupunkiseutu | 24 | 9 | 13 | 2 | under `gate_k` (30): matching has not opened for anybody here. Nine women: the public counter says the total and no split |
| Otaniemi | 156 | 66 | 78 | 12 | the launch pond: over the gate, the largest gender at 50 %, every cell at ten or more, so the counter shows the split |
| Espoo | 96 | 29 | 61 | 6 | men are 64 %, over `majority_share_max` (0.6): the pond the admission rule has to hold back |
| none | 24 | | | | registered at the bank and gone before the first onboarding step: no gender, no pond, no consent |

These are exact counts, apportioned from shares by largest remainder, not draws: the thresholds are crossed by construction. At another size the small pond keeps its 24 people, 8 % never onboarded, and the rest is split 62 to 38 between Otaniemi and Espoo with the same gender shares.

Everybody with a pond has a gender, because the app asks for the gender before the pond.

## What is drawn

| what | how |
|---|---|
| age at the epoch | 18 to 22: 14 %, 23 to 27: 30 %, 28 to 32: 24 %, 33 to 39: 16 %, 40 to 49: 10 %, 50 to 64: 5 %, 65 to 80: 1 %. Stored as year and month of birth, moved so that the product's own age rule (TD-14) gives the age drawn |
| registered | up to 60 days before the epoch; never after it |
| language | Finnish 70 %, Swedish 8 %, English 22 %: the language the consents were shown in and the profile is written in |
| seeks | by own gender. Women: men 78 %, women 8 %, several 14 %. Men: women 82 %, men 7 %, several 11 %. Non-binary people: all three 50 %, two of them 40 %, non-binary only 10 % |
| age window | from 2 to 8 years under the person's age (never under 18) to 2 to 10 years over it (never over 99) |
| consents | terms and privacy for everybody who onboarded; research for 35 % |
| profile | 88 % of those who onboarded have one |
| display name | a given name from the list of the person's gender; the lists hold names with å, ä and ö and two in another script |
| bio | a bio 65 % (a few of the bios are too short to count for completeness, on purpose), a canned line 12 %, nothing 23 % |
| prompts | none 25 %, one 20 %, two 35 %, three 20 % |
| fields | each closed-list field answered by 55 to 85 %, options straight from the registry of `packages/schema`; a campus or guild for 60 % in Otaniemi and 20 % elsewhere |

Nobody has a photo until the photo loader of #73's later part, so nobody in the population has a complete profile yet.

## What makes a synthetic person unmistakable

- The label, `demo-0001` onwards.
- `identity.hetu_hmac` is the SHA-256 of the label, not an HMAC of a code: no bank login maps to it.
- `identity.broker_subject` starts with `kuutti-demo:`, which no broker sends. The writer and `--remove` find the population by it.

## The words

`packages/db/src/seed/words.ts`: given names, campuses and guilds, bios and answers to the twelve prompts, in Finnish, Swedish and English. Every line was written for that file; nothing is copied from a profile, a person or a site. A test in the API runs every line through the plain-text rule of the profile, so a line with something that reads like an address, a number or a handle fails the build.
