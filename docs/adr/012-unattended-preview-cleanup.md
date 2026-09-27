# ADR-012: Preview cleanup runs unattended from main

- Status: accepted
- Date: 2026-09-27
- Follows: TD-2 (free tiers, three previews), TD-19 (one staging box, previews on it), ADR-004 §3 (the reviewer on the `preview` environment follows who can push), `.github/scripts/check-workflow-permissions.py` (no `pull_request_target`), CLAUDE.md "Do not add infrastructure for scale that is not coming"; issue #9, the staging outage of 2026-09-27

## Context

`preview-cleanup.yml` removed a pull request's previews on its `closed` event and in a nightly sweep, both under the `preview` environment, whose required reviewer is the maintainer. The reviewer is right for deploys: `preview.yml` runs a pull request's own code and its own copy of the workflow with the Dokploy and Expo tokens, so someone must look first (ADR-004). For removals it meant that every close and every nightly sweep waited for a click that did not come. On 2026-09-27 the staging box, a t4g.small with 1.8 GB and no swap, carried the previews of three merged pull requests (#64, #66, #69) next to the staging API and Dokploy, which itself takes 0.8 to 1 GB; the kernel's OOM killer took Dokploy every two minutes, each kill broke the Swarm agent's heartbeat, the manager restarted every service, and the API was unreachable for about an hour. The previews were removed by hand.

## Decision

1. **Cleanup never waits for a person.** It runs from `main` only: a sweep every ten minutes that removes the previews of every closed or merged pull request and retires previews older than seven days, and a `workflow_dispatch` for one pull request number or a sweep. The `pull_request: closed` trigger is gone: that event runs the pull request's copy of the workflow, which would hand a contributor the tokens without a reviewer. `pull_request_target` would run main's copy but is banned in this repository, and the ban stands. Ten minutes after a merge is close enough to "on merge" for a box that must never again hold the previews of merged work.
2. **Its own environment, `preview-cleanup`, without a reviewer.** It holds the same two secrets as `preview` (`DOKPLOY_TOKEN`, `EXPO_TOKEN`) and the same variables (`DOKPLOY_URL`, `DOKPLOY_ENVIRONMENT_ID`, `PREVIEW_API_DOMAIN`, `EAS_HOSTING_SUBDOMAIN`). Nothing in the job runs code from a pull request, so nothing needs a reviewer; the tokens stay out of the repository level as before. The `preview` environment keeps its reviewer for deploys.
3. **The database job is unchanged.** It has no environment and exchanges the run's OIDC token for the plan role, which trusts `main`; a scheduled or dispatched run on `main` presents that subject.
4. **Order, and what may block what.** Select, drop the database, remove the EAS alias and branch, remove the Dokploy application. The application is the sweep's work list, so it goes only after its database: a failed drop is retried by the next sweep. A failure at EAS never keeps a container on the box: the application is removed regardless, and the run then fails naming the alias or branch that is left, for a removal by hand. A leftover alias at Expo costs nothing; a leftover container costs the box.
5. **An empty sweep costs seconds.** The selection step needs only `gh`, `curl` and `jq`, which the runner has; pnpm and the EAS CLI are set up only when there is something to remove.

## Consequences

- The maintainer creates the `preview-cleanup` environment once and sets its two secrets (`gh secret set DOKPLOY_TOKEN --env preview-cleanup`, the same for `EXPO_TOKEN`); the variables are copied by API. Until the secrets exist the sweep fails at its first Dokploy call and removes nothing.
- The sticky comment on a closed pull request ("Previews removed") now comes from the sweep, within ten minutes of the close, instead of at once.
- Open, for the box itself (the same outage): swap on the instance and a memory limit on Dokploy's service, so one process growing cannot take the API with it; tracked separately.
