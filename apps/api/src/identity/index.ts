// The identity slice's public surface (rules/layout.md). Discovery is what
// index.ts runs at boot (#32); routes, sessions and the exchange follow (#33-#35).
export { DiscoveryError, discoverProvider, isTeliaIssuer } from "./discovery.ts";
