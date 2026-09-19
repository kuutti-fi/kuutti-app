/** @type {import("jest").Config} */
module.exports = {
  preset: "jest-expo",
  // jest-expo owns apps/mobile; Vitest owns apps/api and packages/* (CLAUDE.md Testing).
  testMatch: ["<rootDir>/src/**/*.test.(ts|tsx)", "<rootDir>/app/**/*.test.(ts|tsx)"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  // lucide ships its per-icon modules as .mjs, which the preset's transform
  // pattern does not cover.
  transform: { "\\.mjs$": "babel-jest" },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|lucide-react-native|nativewind|react-native-css-interop|@rn-primitives/.*|react-native-reanimated|react-native-worklets|i18next|i18next-icu|react-i18next|intl-messageformat|@formatjs/.*)",
  ],
};
