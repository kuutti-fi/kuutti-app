import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import type * as React from "react";
import { saveSession } from "@/lib/session";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import { OnboardingScreen } from "./OnboardingScreen";

const { __router: router } = jest.requireMock("expo-router") as {
  __router: { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
};
// Long enough for a step's call and the two status reads that follow it: an
// update that lands outside an act scope is never flushed in this runtime.
const settle = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const flush = () => act(() => settle(120));
const show = (ui: React.ReactElement) =>
  act(async () => {
    renderWithTheme(ui);
    await settle();
  });
const press = (element: ReturnType<typeof screen.getByRole>) =>
  act(async () => {
    fireEvent.press(element);
    await settle();
  });
const type = (element: ReturnType<typeof screen.getByLabelText>, text: string) =>
  act(async () => {
    fireEvent.changeText(element, text);
    await settle();
  });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const VERSION = "2026-09-draft-1";
const POND = {
  id: "5f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a00",
  slug: "otaniemi",
  name: "Otaniemi",
  nameInessive: "Otaniemessä",
  parentId: null,
};

/** A tiny server: the status is computed from what the steps wrote, as the API does. */
function fakeApi(options: { version?: string } = {}) {
  const current = options.version ?? VERSION;
  const server: {
    gender: string | null;
    seeks: string[] | null;
    ageWindow: { min: number; max: number } | null;
    pond: typeof POND | null;
    consents: { kind: string; version: string; locale: string }[];
  } = { gender: null, seeks: null, ageWindow: null, pond: null, consents: [] };
  const calls: { method: string; path: string; body: unknown }[] = [];
  const status = () => {
    const has = (kind: string) =>
      server.consents.some((c) => c.kind === kind && c.version === VERSION);
    const missing = [
      ...(server.gender ? [] : ["gender"]),
      ...(server.seeks ? [] : ["seeks"]),
      ...(server.ageWindow ? [] : ["age_window"]),
      ...(server.pond ? [] : ["pond"]),
      ...(has("terms") ? [] : ["terms"]),
      ...(has("privacy") ? [] : ["privacy"]),
    ];
    const research = server.consents.find((c) => c.kind === "research");
    return {
      state: missing.length === 0 ? "active" : "registered",
      gender: server.gender,
      pond: server.pond,
      preferences: { seeks: server.seeks, ageWindow: server.ageWindow },
      consents: {
        terms: has("terms") ? VERSION : null,
        privacy: has("privacy") ? VERSION : null,
        research: research ? { version: VERSION, givenAt: "2026-09-26T10:00:00.000Z" } : null,
      },
      currentVersions: { terms: current, privacy: current, research: current },
      missing,
      complete: missing.length === 0,
    };
  };
  globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    const body = request.method === "GET" ? undefined : await request.json();
    calls.push({ method: request.method, path, body });
    if (path === "/onboarding") return json(status());
    if (path === "/ponds") return json({ ponds: [POND] });
    if (path === "/account/gender") {
      server.gender = (body as { gender: string }).gender;
      return new Response(null, { status: 204 });
    }
    if (path === "/preferences") {
      const b = body as { seeks: string[]; ageWindow: { min: number; max: number } };
      server.seeks = b.seeks;
      server.ageWindow = b.ageWindow;
      return json({ seeks: b.seeks, ageWindow: b.ageWindow });
    }
    if (path === "/account/pond") {
      server.pond = POND;
      return new Response(null, { status: 204 });
    }
    if (path === "/consents") {
      server.consents.push(body as { kind: string; version: string; locale: string });
      return json({
        consents: server.consents.map((c) => ({
          ...c,
          givenAt: "2026-09-26T10:00:00.000Z",
          withdrawnAt: null,
        })),
        currentVersions: status().currentVersions,
      });
    }
    return json({ error: { code: "not_found", message: "no", requestId: "r" } }, 404);
  }) as unknown as typeof fetch;
  return { server, calls };
}

const checkA11y = () => {
  const found = pressables(screen.toJSON() as HostNode);
  expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
};

beforeEach(async () => {
  router.replace.mockReset();
  await saveSession({
    sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    accessToken: token("access"),
    accessExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshToken: token("refresh"),
    refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  });
});

describe("OnboardingScreen", () => {
  it("walks a registered account through every step with buttons and leaves when nothing is missing", async () => {
    const { server, calls } = fakeApi();
    await show(<OnboardingScreen />);
    // The consents come first: nothing personal before the person read what happens to it.
    await waitFor(() => expect(screen.getByText("Two things to agree to")).toBeTruthy());
    expect(
      screen.getByText("The Finnish text is the one that counts; this is a translation."),
    ).toBeTruthy();
    expect(screen.getByText("Terms of use")).toBeTruthy();
    expect(screen.getAllByText(`Version ${VERSION}`)).toHaveLength(2);
    checkA11y();
    await press(screen.getByRole("button", { name: "I accept the terms and the privacy notice" }));
    await flush();
    await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
    expect(server.consents.map((c) => [c.kind, c.version, c.locale])).toEqual([
      ["terms", VERSION, "en"],
      ["privacy", VERSION, "en"],
    ]);
    checkA11y();
    await press(screen.getByRole("button", { name: "Woman" }));
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    expect(server.gender).toBe("woman");
    checkA11y();
    await press(screen.getByRole("button", { name: "Men" }));
    await press(screen.getByRole("button", { name: "Non-binary people" }));
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("What ages?")).toBeTruthy());
    await type(screen.getByLabelText("Youngest"), "25");
    await type(screen.getByLabelText("Oldest"), "35");
    checkA11y();
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Where do you want to meet people?")).toBeTruthy());
    expect(server.seeks).toEqual(["man", "non_binary"]);
    expect(server.ageWindow).toEqual({ min: 25, max: 35 });
    await press(screen.getByRole("button", { name: "Otaniemi" }));
    await flush();
    await waitFor(() => expect(screen.getByText("Help us learn how matching works")).toBeTruthy());
    checkA11y();
    await press(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(server.consents).toHaveLength(2);
    expect(calls.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual([
      "/consents",
      "/consents",
      "/account/gender",
      "/preferences",
      "/account/pond",
    ]);
  });

  it("records the research opt-in when the person says yes", async () => {
    const { server } = fakeApi();
    server.gender = "man";
    server.seeks = ["woman"];
    server.ageWindow = { min: 20, max: 30 };
    server.pond = POND;
    server.consents.push(
      { kind: "terms", version: VERSION, locale: "en" },
      { kind: "privacy", version: VERSION, locale: "en" },
    );
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Help us learn how matching works")).toBeTruthy());
    await press(screen.getByRole("button", { name: "Yes, I take part" }));
    await flush();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(server.consents.map((c) => c.kind)).toEqual(["terms", "privacy", "research"]);
  });

  it("refuses to move on from an age window matching cannot use", async () => {
    const { server } = fakeApi();
    server.gender = "woman";
    server.consents.push(
      { kind: "terms", version: VERSION, locale: "en" },
      { kind: "privacy", version: VERSION, locale: "en" },
    );
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    await press(screen.getByRole("button", { name: "Anyone" }));
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("What ages?")).toBeTruthy());
    await type(screen.getByLabelText("Youngest"), "40");
    await type(screen.getByLabelText("Oldest"), "30");
    expect(screen.getByText(/the youngest at most the oldest/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue" }).props.accessibilityState?.disabled,
    ).toBe(true);
    expect(server.seeks).toBeNull();
  });

  it("asks for an app update instead of recording a consent for a wording it did not show", async () => {
    const { server, calls } = fakeApi({ version: "2026-11-final-1" });
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Two things to agree to")).toBeTruthy());
    expect(screen.getByText(/Update the app to continue/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "I accept the terms and the privacy notice" }),
    ).toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(server.consents).toEqual([]);
  });
});
