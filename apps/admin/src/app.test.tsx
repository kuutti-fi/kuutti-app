import { I18nProvider } from "@kuutti/i18n/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./app.tsx";
import { i18n } from "./i18n.ts";

describe("App", () => {
  it("renders the placeholder heading from messages.yaml", () => {
    render(
      <I18nProvider i18n={i18n}>
        <App />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Kuutti admin");
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
