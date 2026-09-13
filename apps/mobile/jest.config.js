/** @type {import("jest").Config} */
module.exports = {
  preset: "jest-expo",
  // jest-expo owns apps/mobile; Vitest owns apps/api and packages/* (CLAUDE.md Testing).
  testMatch: ["<rootDir>/src/**/*.test.(ts|tsx)", "<rootDir>/app/**/*.test.(ts|tsx)"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)",
  ],
};
