import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "@/test/render";
import { SmokeScreen } from "./SmokeScreen";

const ok = {
  status: "ok",
  version: "0.0.0-test",
  commit: "abc1234",
  builtAt: "2026-09-13T00:00:00.000Z",
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
    expect(screen.getByText("db ok · migrations current")).toBeTruthy();
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

  it("gives the retry control a role and a label", async () => {
    mockFetch(async () => jsonResponse(ok));
    await renderWithTheme(<SmokeScreen />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
