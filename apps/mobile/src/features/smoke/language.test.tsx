import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
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

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

function deviceLanguage(...tags: string[]) {
  (useLocales as jest.Mock).mockReturnValue(tags.map((languageTag) => ({ languageTag })));
}

describe("the app's language", () => {
  beforeEach(() => {
    store.clear();
    deviceLanguage("en-US");
    globalThis.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(ok), { headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
  });

  it("renders the smoke screen in English on an English phone", async () => {
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.getByText("database ok · migrations current")).toBeTruthy();
  });

  it("switching the device to Finnish changes it", async () => {
    deviceLanguage("fi-FI", "en-US");
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Yritä uudelleen" })).toBeTruthy(),
    );
    expect(screen.getByText("tietokanta ok · migraatiot current")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Asetukset" })).toBeTruthy();
  });

  it("falls back to English for a phone in a language without a catalogue", async () => {
    deviceLanguage("de-DE");
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
  });

  it("the in-app override beats the device, and is stored", async () => {
    deviceLanguage("fi-FI");
    await renderWithTheme(<SmokeScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Asetukset" }));
    // Languages are listed under their own names, whatever the app's language is.
    await fireEvent.press(await screen.findByRole("radio", { name: "Svenska" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Försök igen" })).toBeTruthy());
    expect(screen.getByRole("radio", { name: "✓ Svenska" })).toBeTruthy();
    expect(store.get("kuutti.preference.locale")).toBe("sv");
  });

  it("a stored override applies at the next start, and choosing the phone's language clears it", async () => {
    store.set("kuutti.preference.locale", "fi");
    await renderWithTheme(<SmokeScreen />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Yritä uudelleen" })).toBeTruthy(),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Asetukset" }));
    await fireEvent.press(await screen.findByRole("radio", { name: "Puhelimen kieli" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    await act(async () => undefined);
    expect(store.has("kuutti.preference.locale")).toBe(false);
  });

  it("offers en-XA in a dev build, elongated and bracketed", async () => {
    await renderWithTheme(<SmokeScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Settings" }));
    await fireEvent.press(await screen.findByRole("radio", { name: "［Pseudo］" }));
    await waitFor(() => expect(screen.getByText("［Réétrýý］")).toBeTruthy());
  });

  it("makes an unknown key a type error", () => {
    const probe = (t: import("@kuutti/i18n").TFunction) => {
      // @ts-expect-error not a key of messages.yaml
      t("does.not.exist");
    };
    expect(probe).toBeInstanceOf(Function);
  });
});
