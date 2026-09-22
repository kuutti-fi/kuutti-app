// The identity slice's public surface (rules/layout.md). Discovery is what
// index.ts runs at boot (#32); routes, sessions and the exchange follow (#33-#35).

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
