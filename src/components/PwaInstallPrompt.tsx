import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { catalogKey, copy } from "../i18n/catalog";
import {
  dismissPwaInstallPrompt,
  getPwaInstallAvailability,
  getPwaInstallRevision,
  promptPwaInstall,
  subscribePwaInstall
} from "../lib/pwaInstall";
import { Icon } from "./Icon";

const DISPLAY_DELAY_MS = 1200;

export function PwaInstallPrompt() {
  const { locale } = useI18n();
  const [delayElapsed, setDelayElapsed] = useState(false);
  useSyncExternalStore(subscribePwaInstall, getPwaInstallRevision, getPwaInstallRevision);
  const availability = getPwaInstallAvailability();

  useEffect(() => {
    if (availability === "none") {
      setDelayElapsed(false);
      return;
    }
    const timer = window.setTimeout(() => setDelayElapsed(true), DISPLAY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [availability]);

  if (availability === "none" || !delayElapsed) return null;

  const isIos = availability === "ios";
  const dismiss = () => dismissPwaInstallPrompt();

  return (
    <aside className="pwa-install-prompt" aria-labelledby="pwa-install-title" data-testid="pwa-install-prompt">
      <span className="pwa-install-prompt__icon" aria-hidden="true">
        <Icon name="download" size={20} />
      </span>
      <div className="pwa-install-prompt__content">
        <strong id="pwa-install-title">{copy(locale, "pwaInstall", "title")}</strong>
        <p>{copy(locale, "pwaInstall", catalogKey("pwaInstall", isIos ? "iosDescription" : "browserDescription"))}</p>
      </div>
      <div className="pwa-install-prompt__actions">
        {isIos ? (
          <button className="button button--secondary" type="button" onClick={dismiss}>
            {copy(locale, "pwaInstall", "understood")}
          </button>
        ) : (
          <button className="button button--primary" type="button" onClick={() => void promptPwaInstall()} data-testid="pwa-install-action">
            {copy(locale, "pwaInstall", "install")}
          </button>
        )}
        {!isIos ? (
          <button className="button button--quiet" type="button" onClick={dismiss}>
            {copy(locale, "pwaInstall", "later")}
          </button>
        ) : null}
      </div>
      <button className="icon-button pwa-install-prompt__close" type="button" onClick={dismiss} aria-label={copy(locale, "pwaInstall", "dismiss")}>
        <Icon name="close" size={17} />
      </button>
    </aside>
  );
}
