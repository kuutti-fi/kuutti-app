// Public surface of the matching slice in apps/api. Other slices import from here only.
// #46 brings the two hard rows of onboarding; the rounds and their rules are M4.

export { deletePreferencesOfAccount, readPreferences } from "./preferences.ts";
export { preferencesRoutes } from "./routes.ts";
