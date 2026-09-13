# ADR-002: Gherkin as the specification for the rules layer, Vitest as the only runner

- Status: accepted
- Date: 2026-09-13
- Follows: TD-1, TD-7 (identity and standing), TD-10 to TD-15 (matching rules), TD-2 (test runners)

## Context

Acceptance criteria written in prose by an agent and checked by an agent verify nothing. The specification and the test are two documents that drift, and "done" is a judgement. The parts of this codebase where being wrong is expensive are also the parts that are naturally tabular: identity standing and re-registration (a state machine whose failure is a ban washed off by deleting an account), matching rules full of exact numbers (K = 30, majority at most 60 %, 12 cards, 40 impressions, 14-day like expiry, 90-day pass cooldown, contest-based budgets), the both-direction filter check that a refactor is most likely to break quietly, and erasure, where what survives deletion is a table that also belongs in front of the DPIA.

The rest of the codebase is plumbing: the image pipeline, UI, accessibility, i18n, infrastructure, CRUD. Given/When/Then around "the endpoint returns 404 for an unknown id" is ceremony.

There is also a benefit specific to agent-written code: a `.feature` file is an unusually good prompt. It is unambiguous, table-driven, and states the negative cases explicitly, which is exactly where an agent improvises when left vague.

## Decision

**Gherkin `.feature` files are the specification of the rules layer. Vitest is the runner. There is no step-definition layer.**

### Scope rule

Only the rules layer gets `.feature` files. At launch that means the slices `identity`, `matching`, `pond` and `safety`, plus erasure. Everything else gets ordinary tests. The mechanical test: if the `Given` block needs more than three lines of setup, the behaviour does not belong in Gherkin.

### Where files live

`features/<slice>/<topic>.feature`. One directory per slice, matching the slice names in `.claude/rules/layout.md`. Scenario names are unique across the whole `features/` tree, because the name is the link to the test.

### Bridge convention

- A `Scenario` becomes a Vitest `it()` whose name is the scenario name copied verbatim.
- A `Scenario Outline` becomes a `describe()` whose name is the outline name verbatim, containing an `it.each` over the `Examples` rows, one case per row, with the row values interpolated into the case name.
- Tests live where the slice lives (`apps/api/src/<slice>/*.test.ts`, `packages/*/src/**/*.test.ts`), not in `features/`.
- A scenario tagged `@pending`, or belonging to a Feature tagged `@pending`, is exempt: the specification may land before the slice exists. The pull request that implements a scenario removes the tag.

### The check

`scripts/check-scenarios.ts`, run by `pnpm check:scenarios` in CI, parses every `.feature` file, collects scenario names, scans every `*.test.ts` and `*.test.tsx` under `apps/` and `packages/` for string literals, and fails when a scenario that is not `@pending` has no test file containing its exact name, or when two scenarios share a name. It has no dependencies and is about a hundred lines. It is what stops the feature files rotting into decoration.

### Tables are configuration

An `Examples` table over matching tunables is at once the specification, the test fixture, and the documentation of what the knob does. The numbers in those tables are the same numbers `matching_config` carries. When the research partner asks what happens at contest 1.5, the answer is a row. Changing a number in a table is a decision, recorded as an ADR or a `matching_config` version, never a test edit.

## Consequences

- An issue's "done when" for rules-layer work is a list of scenario names that must pass, checkable by CI, not by reading.
- `.feature` files for `matching`, `pond` and `safety` are written with the slice that implements them (M3, M4); `features/identity/re-registration.feature` lands now, tagged `@pending`, and its tag comes off in M2.
- The erasure feature file doubles as the artefact shown to the DPIA reviewer and the research partner. Those two files, and only those, are where the "business readable" promise of Gherkin is expected to hold; nobody else will read the rest, and that is fine.
- Over-application is the known failure mode. The scope rule is written into `CLAUDE.md` so an agent does not produce three scenarios for a health endpoint.

## Alternatives considered

**Cucumber (`@cucumber/cucumber`).** The regex-to-code step-definition tier is where BDD projects historically died: a second test runner, a glue layer that becomes its own maintenance burden, and steps that drift from the code they call. It would also violate the standing rule "Vitest for api and packages, jest-expo for mobile, do not mix them" on day one.

**Vitest Gherkin plugins (`@amiceli/vitest-cucumber` and similar).** Same glue tier inside Vitest; the scenario text is parsed at test time and steps are matched by string. Less machinery than Cucumber, still a second dialect for every test author, and a dependency on a small project for the most important tests in the repository.

**Prose acceptance criteria with review.** What we had. Unverifiable by construction, and the agent-writes-agent-checks loop makes it worse rather than better.

**Gherkin everywhere.** Rejected by the scope rule. Every trivial endpoint with three scenarios is how teams learn to hate the format.
