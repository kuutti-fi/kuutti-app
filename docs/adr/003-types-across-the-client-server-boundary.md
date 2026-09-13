# ADR-003: Types across the client-server boundary

- Status: accepted
- Date: 2026-09-13
- Follows: TD-2 (Hono, zod contracts), TD-19 (open decision on RPC style), ADR-002

## Context

REST as the wire format is settled: machine callers (the Telia redirect, SNS bounce notifications) need plain HTTP endpoints, path-based rate limiting and velocity detection are central to the anti-scraping design, and an AGPL repository benefits from a documented API. The open question was how the mobile app and the admin panel get types for that API without drift.

Three ways were on the table:

1. **Inferred**: Hono's `hc<typeof app>()` client. Best ergonomics, zero build step. The type of the whole app is inferred from every route, and the cost of that inference lands on the client's TypeScript project. With dozens of routes and zod contracts, the mobile typecheck slows down and editor feedback degrades; the failure mode is a codebase people stop typechecking.
2. **Generated**: routes declared with `@hono/zod-openapi`, an OpenAPI document produced from them, and `openapi-typescript` turning it into a `paths` type the clients consume through `openapi-fetch`. One build step, a committed document, no inference cliff.
3. **Declared**: shared zod schemas plus a hand-written client. About two hundred lines of boilerplate, no risk, and a client that drifts the day someone adds a route without touching it.

## Decision

**Generated.** Routes are declared with `createRoute` from `@hono/zod-openapi`, using the zod schemas from `packages/schema` as the request and response contracts. `pnpm openapi` writes `apps/api/openapi.json` from the running app and regenerates `packages/schema/src/api.generated.ts`. Clients use `openapi-fetch` typed by those paths, and parse responses with the same zod schema at runtime where the value matters.

Both files are committed. CI runs the generator and fails on a diff, so the document can only change together with the routes that define it. The document is served at `/openapi.json` in every environment except production, where the API surface is not advertised.

Validation and typing meet in one place: the contract that validates a request at the boundary is the same object that describes it to clients. There is no second schema to keep in step.

## Consequences

- Adding a route means declaring it with `createRoute`; a plain `app.get` still works for internal endpoints but appears in no client type and no document.
- The generated types file is large and boring; nobody edits it. The generator header says so.
- `openapi-fetch` treats every non-2xx response as `error`, typed by the declared error responses. The one error envelope (`ErrorResponse`) is therefore what clients handle, with `requestId` for support.
- The document doubles as the public API reference for the repository.

## Alternatives considered

**`hc<typeof app>`** rejected for the inference cost described above; it stays a fine choice for small internal apps.

**Hand-written client** rejected because drift is silent: nothing fails when a route and the client disagree until a user hits it.

**tRPC** never entered the shortlist: it replaces the wire format, and REST is settled.
