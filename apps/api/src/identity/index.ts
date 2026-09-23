// The identity slice's public surface (rules/layout.md). Discovery is what
// index.ts runs at boot (#32); the routes carry the login (#33) and the
// sessions (#35); the store is what the session middleware in lib/ reads through.

export { BrokerError, type BrokerIdentity, type IdentityBroker } from "./broker.ts";
export { DiscoveryError, discoverProvider, isTeliaIssuer } from "./discovery.ts";
// hetu.ts stays inside the slice: nothing outside it may hold a hetu (rules/api.md).
export { brokerOptionsFromConfig, OidcBroker } from "./oidc-broker.ts";
export {
  decideRegistration,
  REREGISTER_COOLDOWN_DAYS,
  type RegistrationDecision,
  recordDeletion,
} from "./registration.ts";
export { authRoutes } from "./routes.ts";
export { sessionStore } from "./session-store.ts";
export { sweepSessions } from "./sessions.ts";
