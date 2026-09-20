import { screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "@/test/render";
import { SmokeScreen } from "./SmokeScreen";

// The line under the API card says which JavaScript the phone runs. Its inputs
// are expo-updates constants, so this file mocks the module as a whole (the
// other smoke tests keep jest-expo's default) and mutates it per case: the
// screen reads the constants at render time, not at import.
jest.mock("expo-updates", () => ({
  __esModule: true,
  channel: "staging",
  isEnabled: true,
  isEmbeddedLaunch: false,
  updateId: "01a0bf1b-2d90-775a-9c60-e432a6dc61e9",
  createdAt: new Date("2026-09-20T13:55:16Z"),
}));

type UpdatesMock = {
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
  createdAt: Date | null;
};
const Updates = jest.requireMock("expo-updates") as UpdatesMock;

const ok = {
  status: "ok",
  version: "0.0.0-test",
  commit: "abc1234",
  builtAt: "2026-09-13T00:00:00.000Z",
  source: "https://github.com/kuutti-fi/kuutti-app",
  db: "ok",
  migrations: "current",
};

describe("the line that names the JavaScript the phone runs", () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(ok), { headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    Updates.isEnabled = true;
    Updates.isEmbeddedLaunch = false;
    Updates.updateId = "01a0bf1b-2d90-775a-9c60-e432a6dc61e9";
    Updates.createdAt = new Date("2026-09-20T13:55:16Z");
  });

  it("names the applied update by its short id and publish time", async () => {
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() => expect(screen.getByText("API 0.0.0-test")).toBeTruthy());
    // The time part depends on the runner's zone; the id and the shape do not.
    expect(screen.getByText(/^App update 01a0bf1b, published \d/)).toBeTruthy();
  });

  it("says so when the phone runs the bundle embedded in the build", async () => {
    Updates.isEmbeddedLaunch = true;
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() => expect(screen.getByText("API 0.0.0-test")).toBeTruthy());
    expect(screen.getByText("App code from the build, no update applied")).toBeTruthy();
    expect(screen.queryByText(/^App update/)).toBeNull();
  });

  it("shows nothing in a session where updates are disabled, such as Metro", async () => {
    Updates.isEnabled = false;
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() => expect(screen.getByText("API 0.0.0-test")).toBeTruthy());
    expect(screen.queryByText(/^App update|^App code/)).toBeNull();
  });
});
