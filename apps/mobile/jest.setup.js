// Reanimated 4 and its worklets runtime are native; in jest they run as the
// mocks the two packages ship (#12).
jest.mock("react-native-worklets", () => require("react-native-worklets/lib/module/mock"));
require("react-native-reanimated").setUpTests();

// The device's languages and the preference store are native; tests set them
// through these mocks (src/features/smoke/language.test.tsx) and start from an English phone
// with nothing stored.
jest.mock("expo-localization", () => ({
  useLocales: jest.fn(() => [{ languageTag: "en-US" }]),
}));
jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key, value) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key) => void store.delete(key)),
  };
});

// The Sentry SDK is native and ships ESM; tests get a stand-in and can assert
// on what was reported (never the stored value, only the error).
jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  wrap: (component) => component,
  captureException: jest.fn(),
}));
