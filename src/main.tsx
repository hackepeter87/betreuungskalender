import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { HelpPreferencesProvider } from "./context/HelpPreferences";
import { I18nProvider } from "./i18n/I18nProvider";
import { AppStoreProvider } from "./store/AppStore";
import { isRunningStandalone } from "./lib/pwaInstall";
import { initializeOptionalServiceWorker } from "./lib/serviceWorker";
import { PublicDemoPage } from "./pages/PublicDemoPage";
import "@fontsource-variable/inter/wght.css";
import "./styles.css";

const publicDemo = window.location.pathname === "/demo";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      {publicDemo ? <PublicDemoPage /> : (
        <HelpPreferencesProvider>
          <AppStoreProvider>
            <App />
          </AppStoreProvider>
        </HelpPreferencesProvider>
      )}
    </I18nProvider>
  </StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void initializeOptionalServiceWorker(isRunningStandalone()).catch(() => {
      // Optional installation and push features remain unavailable on failure.
    });
  });
}
