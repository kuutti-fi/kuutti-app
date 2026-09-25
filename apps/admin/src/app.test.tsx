import { I18nProvider } from "@kuutti/i18n/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import { StaffSessionProvider } from "./features/identity/index.ts";
import { i18n } from "./i18n.ts";
import { apiUrl } from "./source-offer.tsx";

const health = {
  status: "ok",
  version: "0.0.0-test",
  commit: "abc1234",
  builtAt: "2026-09-13T00:00:00.000Z",
  source: "https://codeberg.org/example/kuutti-fork",
  db: "ok",
  migrations: "current",
};

function renderApp(answer: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(answer));
  render(
    <I18nProvider i18n={i18n}>
      <StaffSessionProvider>
        <App />
      </StaffSessionProvider>
    </I18nProvider>,
  );
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("App", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  // Without vitest globals, Testing Library does not unmount between tests by itself.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the heading from messages.yaml and, signed out, the bank login", async () => {
    renderApp(async () => json(health));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Kuutti admin");
    expect(
      await screen.findByRole("button", { name: "Sign in with your bank" }),
    ).toBeInTheDocument();
  });

  it("offers the source the running API names, with its commit (AGPL-3.0 section 13)", async () => {
    renderApp(async () => json(health));
    const link = await screen.findByRole("link", {
      name: "https://codeberg.org/example/kuutti-fork",
    });
    expect(link).toHaveAttribute("href", "https://codeberg.org/example/kuutti-fork");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("commit abc1234");
  });

  it("says so when the API cannot be reached, and never links an address that is not https", async () => {
    renderApp(async () => json({ ...health, source: "javascript:alert(1)" }));
    expect(await screen.findByText(/The API cannot be reached/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("falls back to the local API on a development server only, never in a production build", () => {
    expect(apiUrl({ PROD: false })).toBe("http://localhost:3000");
    expect(apiUrl({ PROD: true })).toBeUndefined();
    expect(apiUrl({ PROD: true, VITE_API_URL: "https://api.kuutti.app" })).toBe(
      "https://api.kuutti.app",
    );
  });

  it("makes an unknown key a type error", () => {
    // Compile-time assertion: tsc fails on an unused @ts-expect-error.
    const probe = (t: import("@kuutti/i18n").TFunction) => {
      // @ts-expect-error not a key of messages.yaml
      t("does.not.exist");
    };
    expect(probe).toBeTypeOf("function");
  });
});
