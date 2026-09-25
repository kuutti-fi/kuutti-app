import "./styles.css";
import { I18nProvider } from "@kuutti/i18n/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { StaffSessionProvider } from "./features/identity/index.ts";
import { i18n } from "./i18n.ts";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <StaffSessionProvider>
        <App />
      </StaffSessionProvider>
    </I18nProvider>
  </StrictMode>,
);
