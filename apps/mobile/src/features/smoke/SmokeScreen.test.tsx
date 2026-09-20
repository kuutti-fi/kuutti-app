import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { renderWithTheme } from "@/test/render";
import { SmokeScreen } from "./SmokeScreen";

const ok = {
  status: "ok",
  version: "0.0.0-test",
  commit: "abc1234",
  builtAt: "2026-09-13T00:00:00.000Z",
  source: "https://github.com/kuutti-fi/kuutti-app",
  db: "ok",
  migrations: "current",
};

function mockFetch(impl: () => Promise<Response>) {
  globalThis.fetch = jest.fn(impl) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SmokeScreen", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the API version and commit when the API answers", async () => {
    mockFetch(async () => jsonResponse(ok));
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() => expect(screen.getByText("API 0.0.0-test")).toBeTruthy());
    expect(screen.getByText("commit abc1234")).toBeTruthy();
    expect(screen.getByText("database ok · migrations current")).toBeTruthy();
  });

  it("shows an explicit error state when the API is unreachable, and retries", async () => {
    mockFetch(async () => {
      throw new Error("Network request failed");
    });
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() => expect(screen.getByLabelText("API unreachable")).toBeTruthy());
    expect(screen.getByText("Network request failed")).toBeTruthy();

    mockFetch(async () => jsonResponse(ok));
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByLabelText("API status")).toBeTruthy());
  });

  it("offers the source of the running service: its address as text, its commit, and a labelled link", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    mockFetch(async () => jsonResponse(ok));
    await renderWithTheme(<SmokeScreen />);
    const link = await screen.findByRole("link", { name: "Open the source code in the browser" });
    expect(screen.getByText("https://github.com/kuutti-fi/kuutti-app")).toBeTruthy();
    expect(screen.getByText(/This service runs commit abc1234/)).toBeTruthy();
    await fireEvent.press(link);
    expect(openURL).toHaveBeenCalledWith("https://github.com/kuutti-fi/kuutti-app");
  });

  it("refuses a health answer whose source is not an https address", async () => {
    mockFetch(async () => jsonResponse({ ...ok, source: "javascript:alert(1)" }));
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() => expect(screen.getByLabelText("API unreachable")).toBeTruthy());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("gives the retry control a role and a label", async () => {
    mockFetch(async () => jsonResponse(ok));
    await renderWithTheme(<SmokeScreen />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
