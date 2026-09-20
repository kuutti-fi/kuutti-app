import { screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "@/test/render";
import { SmokeScreen } from "./SmokeScreen";

// The App card says which JavaScript the phone runs: the commit stamped by
// app.config.ts and the update expo-updates applied. Both are constants read
// at render time, so this file mocks the two modules as a whole (the other
// smoke tests keep jest-expo's defaults) and mutates them per case.
jest.mock("expo-updates", () => ({
  __esModule: true,
  channel: "staging",
  isEnabled: true,
  isEmbeddedLaunch: false,
  updateId: "01a0bf1b-2d90-775a-9c60-e432a6dc61e9",
  createdAt: new Date("2026-09-20T13:55:16Z"),
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { commit: "1a2b3c4" } } },
}));

type UpdatesMock = {
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
  createdAt: Date | null;
};
const Updates = jest.requireMock("expo-updates") as UpdatesMock;
const Constants = (jest.requireMock("expo-constants") as { default: { expoConfig: unknown } })
  .default;

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
  await waitFor(() => expect(screen.getByText("version 0.0.0-test")).toBeTruthy());
}

describe("the App card: which JavaScript the phone runs", () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(ok), { headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    Updates.isEnabled = true;
    Updates.isEmbeddedLaunch = false;
    Updates.updateId = "01a0bf1b-2d90-775a-9c60-e432a6dc61e9";
    Updates.createdAt = new Date("2026-09-20T13:55:16Z");
    Constants.expoConfig = { extra: { commit: "1a2b3c4" } };
  });

  it("names the app's own commit apart from the API's", async () => {
    await renderAndSettle();
    expect(screen.getByText("git commit 1a2b3c4")).toBeTruthy();
    expect(screen.getByText("git commit abc1234")).toBeTruthy();
    expect(screen.getByLabelText("App version")).toBeTruthy();
  });

  it("names the applied update by its short id and publish time", async () => {
    await renderAndSettle();
    // The time part depends on the runner's zone; the id and the shape do not.
    expect(screen.getByText(/^update 01a0bf1b, published \d/)).toBeTruthy();
  });

  it("says so when the phone runs the bundle embedded in the build", async () => {
    Updates.isEmbeddedLaunch = true;
    await renderAndSettle();
    expect(screen.getByText("code from the build, no update applied")).toBeTruthy();
    expect(screen.queryByText(/^update/)).toBeNull();
  });

  it("says so in a session where updates are disabled, such as Metro", async () => {
    Updates.isEnabled = false;
    await renderAndSettle();
    expect(screen.getByText("development server, no updates")).toBeTruthy();
  });

  it("says when the running code predates the commit stamp", async () => {
    Constants.expoConfig = { extra: {} };
    await renderAndSettle();
    expect(screen.getByText("git commit not recorded in this build")).toBeTruthy();
    expect(screen.queryByText("git commit 1a2b3c4")).toBeNull();
  });
});
