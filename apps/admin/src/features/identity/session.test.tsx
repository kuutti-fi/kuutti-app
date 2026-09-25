import { I18nProvider } from "@kuutti/i18n/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n.ts";
import { SignIn } from "./SignIn.tsx";
import { readFragment, StaffSessionProvider, useStaffSession } from "./session.tsx";

// The staff session in the browser (#49): the code from the fragment is
// exchanged once and the fragment is consumed; a refusal is shown; a stored
// session is checked with the API before it is trusted.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const session = {
  accessToken: "a".repeat(43),
  expiresAt: "2030-01-01T08:00:00.000Z",
  role: "moderator",
};

function Probe() {
  const state = useStaffSession();
  return (
    <p data-testid="state">
      {state.status}
      {state.status === "signed-in" ? ` ${state.session.role}` : ""}
    </p>
  );
}

function show(strict = false) {
  const tree = (
    <I18nProvider i18n={i18n}>
      <StaffSessionProvider>
        <Probe />
        <SignIn />
      </StaffSessionProvider>
    </I18nProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("staff session", () => {
  it("reads a code or an error from the fragment and nothing from anything else", () => {
    expect(readFragment("#code=abc")).toEqual({ code: "abc" });
    expect(readFragment("#error=admin_not_allowed")).toEqual({ error: "admin_not_allowed" });
    expect(readFragment("")).toEqual({});
    expect(readFragment("#other=1")).toEqual({});
  });

  it("exchanges the code from the fragment once, consumes the fragment and keeps the session", async () => {
    const calls: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        calls.push(req);
        return json(session);
      }),
    );
    window.history.replaceState(null, "", `/#code=${"c".repeat(43)}`);
    show();
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("signed-in moderator"),
    );
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/admin/auth/exchange");
    expect(JSON.parse(await (calls[0] as Request).text())).toEqual({ code: "c".repeat(43) });
    expect(window.location.hash).toBe("");
    expect(JSON.parse(window.sessionStorage.getItem("kuutti.admin.session") ?? "{}")).toMatchObject(
      { role: "moderator" },
    );
  });

  it("exchanges the code once under StrictMode, whose double effect must not burn it", async () => {
    const calls: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        calls.push(req);
        return json(session);
      }),
    );
    window.history.replaceState(null, "", `/#code=${"d".repeat(43)}`);
    show(true);
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("signed-in moderator"),
    );
    expect(calls.filter((c) => new URL(c.url).pathname === "/admin/auth/exchange")).toHaveLength(1);
  });

  it("shows the refusal the fragment carried and offers the bank login", async () => {
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState(null, "", "/#error=admin_not_allowed");
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("no moderator role");
    expect(screen.getByRole("button", { name: "Sign in with your bank" })).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("checks a stored session with the API and drops it when the API refuses", async () => {
    window.sessionStorage.setItem("kuutti.admin.session", JSON.stringify(session));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { code: "session_expired", message: "x", requestId: "r" } }, 401),
      ),
    );
    show();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));
    expect(window.sessionStorage.getItem("kuutti.admin.session")).toBeNull();
  });

  it("sends the stored token with the very first request after a reload", async () => {
    window.sessionStorage.setItem("kuutti.admin.session", JSON.stringify(session));
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        seen.push(req.headers.get("authorization") ?? "");
        return json({ role: session.role, expiresAt: session.expiresAt });
      }),
    );
    show();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in"));
    expect(seen).toEqual([`Bearer ${session.accessToken}`]);
    expect(window.sessionStorage.getItem("kuutti.admin.session")).not.toBeNull();
  });

  it("the sign-in button sends the browser to the staff login of the API", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const assign = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      assign,
      hash: "",
      pathname: "/",
      search: "",
      href: "http://localhost/",
    });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with your bank" }));
    expect(assign).toHaveBeenCalledWith("http://localhost:3000/admin/auth/start");
  });
});
