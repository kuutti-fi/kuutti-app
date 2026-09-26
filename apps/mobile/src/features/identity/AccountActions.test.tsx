import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import type * as React from "react";
import { clearSession, currentSession, saveSession } from "@/lib/session";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import { AccountActions } from "./AccountActions";

// The account card (#51): export handed to the share sheet, deletion only
// after the confirmation, the device signed out when the API says 204.

const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const session = {
  sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
  accessToken: token("access"),
  accessExpiresAt: "2030-01-01T00:15:00.000Z",
  refreshToken: token("refresh"),
  refreshExpiresAt: "2030-04-01T00:00:00.000Z",
};
const exported = {
  exportedAt: "2026-09-26T10:00:00.000Z",
  account: {
    id: "0b1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a01",
    state: "active",
    registeredAt: "2026-09-01T00:00:00.000Z",
    birthYear: 1990,
    birthMonth: 6,
  },
  identity: {
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    lastBankLoginAt: null,
    loginLevel: null,
    deletionCount: 0,
  },
  sessions: [],
  profile: null,
  photos: [],
  photoAccessLog: [],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fetchMock(handlers: Array<(req: Request) => Response | null>) {
  const calls: Request[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push(req);
    for (const handler of handlers) {
      const res = handler(req);
      if (res) return res;
    }
    throw new Error(`unexpected ${req.method} ${req.url}`);
  }) as unknown as typeof fetch;
  return calls;
}
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
const show = async (ui: React.ReactElement) => {
  await act(async () => {
    renderWithTheme(ui);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  });
};

beforeEach(async () => {
  await saveSession(session);
});
afterEach(async () => {
  await clearSession();
});

describe("AccountActions", () => {
  it("shows the two labelled buttons and nothing pressable is unlabelled or too small", async () => {
    fetchMock([]);
    await show(<AccountActions />);
    expect(await screen.findByText("Your account")).toBeTruthy();
    const found = pressables(screen.toJSON() as HostNode);
    expect(found).toHaveLength(2);
    expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
  });

  it("hands the export to the share sheet as JSON", async () => {
    const calls = fetchMock([
      (req) => (new URL(req.url).pathname === "/account/export" ? json(exported) : null),
    ]);
    const share = jest.fn(async () => ({ action: "sharedAction" as const }));
    await show(<AccountActions share={share as never} />);
    await fireEvent.press(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    const [payload] = share.mock.calls[0] as unknown as [{ title: string; message: string }];
    expect(payload.title).toBe("Your Kuutti data");
    expect(JSON.parse(payload.message)).toEqual(exported);
    expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${session.accessToken}`);
  });

  it("says so when the export fails", async () => {
    fetchMock([
      (req) =>
        new URL(req.url).pathname === "/account/export"
          ? json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500)
          : null,
    ]);
    await show(<AccountActions share={jest.fn() as never} />);
    await fireEvent.press(screen.getByRole("button", { name: "Download my data" }));
    expect(await screen.findByText("The download did not work. Try again.")).toBeTruthy();
  });

  it("deletes only after the confirmation, with confirm true, and signs the device out", async () => {
    const calls = fetchMock([
      (req) =>
        req.method === "POST" && new URL(req.url).pathname === "/account/delete"
          ? new Response(null, { status: 204 })
          : null,
    ]);
    await show(<AccountActions />);
    await fireEvent.press(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByText("Delete your account?")).toBeTruthy();
    expect(screen.getByText(/A new account is possible after 30 days/)).toBeTruthy();
    expect(calls).toHaveLength(0);
    const found = pressables(screen.toJSON() as HostNode);
    expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);

    await fireEvent.press(screen.getByRole("button", { name: "Keep my account" }));
    await settle();
    expect(calls).toHaveLength(0);
    expect(currentSession()?.sessionId).toBe(session.sessionId);

    await fireEvent.press(screen.getByRole("button", { name: "Delete my account" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Delete everything" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(await (calls[0] as Request).text())).toEqual({ confirm: true });
    await waitFor(() => expect(currentSession()).toBeNull());
    // Signed out: the card is gone with the session.
    await waitFor(() => expect(screen.queryByText("Your account")).toBeNull());
  });

  it("keeps the session when the deletion fails and says so", async () => {
    fetchMock([
      (req) =>
        req.method === "POST"
          ? json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500)
          : null,
    ]);
    await show(<AccountActions />);
    await fireEvent.press(screen.getByRole("button", { name: "Delete my account" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Delete everything" }));
    expect(await screen.findByText("The deletion did not go through. Try again.")).toBeTruthy();
    expect(currentSession()?.sessionId).toBe(session.sessionId);
  });
});
