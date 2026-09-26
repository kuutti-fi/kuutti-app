import { screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "@/test/render";
import { SmokeScreen } from "./SmokeScreen";

// The App card names the commit app.config.ts stamped into the config.
// expo-constants is mocked as a whole here (the other smoke tests keep
// jest-expo's default) and mutated per case: the screen reads it at render
// time, not at import.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { commit: "1a2b3c4" } } },
}));

type ConstantsMock = { expoConfig: { extra: { commit?: string } } };
const Constants = (jest.requireMock("expo-constants") as { default: ConstantsMock }).default;

const ok = {
  status: "ok",
  version: "0.0.0-test",
  commit: "abc1234",
  builtAt: "2026-09-13T00:00:00.000Z",
  source: "https://github.com/kuutti-fi/kuutti-app",
  db: "ok",
  migrations: "current",
};

async function renderAndSettle() {
  await renderWithTheme(<SmokeScreen />);
  await waitFor(() => expect(screen.getByText("git commit abc1234")).toBeTruthy());
}

// expo-updates as a staging build that runs an over-the-air update would report it.
jest.mock("expo-updates", () => ({
  channel: "staging",
  runtimeVersion: "88a4337f0053b4dd4b1b1f9560daf6ddf0fcf68d",
  isEmbeddedLaunch: false,
  createdAt: new Date("2026-09-26T17:35:00.000Z"),
}));

describe("the App card: the app's own commit, apart from the API's", () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(ok), { headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    Constants.expoConfig = { extra: { commit: "1a2b3c4" } };
  });

  it("names the app's commit under App and the API's under API", async () => {
    await renderAndSettle();
    expect(screen.getByLabelText("App version")).toBeTruthy();
    expect(screen.getByText("git commit 1a2b3c4")).toBeTruthy();
    expect(screen.getByText("API")).toBeTruthy();
    expect(screen.getByText("App")).toBeTruthy();
  });

  it("says when the running code predates the commit stamp", async () => {
    Constants.expoConfig = { extra: {} };
    await renderAndSettle();
    expect(screen.getByText("git commit not recorded in this build")).toBeTruthy();
    expect(screen.queryByText("git commit 1a2b3c4")).toBeNull();
  });

  it("names the native build's runtime and the update it runs, so a stalled commit is explained", async () => {
    await renderAndSettle();
    expect(screen.getByText("native build 88a4337")).toBeTruthy();
    expect(screen.getByText(/^update published /)).toBeTruthy();
  });
});
