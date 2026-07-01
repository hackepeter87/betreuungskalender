import { useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { TranslationKey } from "../i18n/resources";
import { logoutSession } from "../lib/api";
import { useAppStore } from "../store/AppStore";
import type { ApiSession } from "../../shared/api";
import type { IconName } from "./Icon";
import { Icon } from "./Icon";

export type PageId =
  | "dashboard"
  | "calendar"
  | "entries"
  | "contact"
  | "holidays"
  | "unavailable"
  | "analytics"
  | "report"
  | "backup"
  | "audit"
  | "rules"
  | "settings";

const navItems: Array<{
  id: PageId;
  labelKey: TranslationKey;
  icon: IconName;
}> = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: "home" },
  { id: "calendar", labelKey: "nav.calendar", icon: "calendar" },
  { id: "entries", labelKey: "nav.entries", icon: "list" },
  { id: "contact", labelKey: "nav.contact", icon: "repeat" },
  { id: "holidays", labelKey: "nav.holidays", icon: "sun" },
  { id: "unavailable", labelKey: "nav.unavailable", icon: "briefcase" },
  { id: "analytics", labelKey: "nav.analytics", icon: "chart" },
  { id: "report", labelKey: "nav.report", icon: "fileText" },
  { id: "backup", labelKey: "nav.backup", icon: "backup" },
  { id: "audit", labelKey: "nav.audit", icon: "history" },
  { id: "rules", labelKey: "nav.rules", icon: "book" }
];

const mobileNavItems = navItems.filter((item) =>
  ["dashboard", "calendar", "entries", "analytics"].includes(item.id)
);

function AuthSessionCard({
  session,
  mobile = false,
  loggingOut,
  onLogout,
  t
}: {
  session: ApiSession;
  mobile?: boolean;
  loggingOut: boolean;
  onLogout: () => void;
  t: (key: TranslationKey) => string;
}) {
  if (session.authenticated && session.user) {
    const nativeLogout = session.logoutUrl === "/auth/logout";
    return (
      <div
        className={`session-card${mobile ? " session-card--mobile" : ""}`}
        data-testid={mobile ? "mobile-auth-session" : "auth-session"}
      >
        <Icon name="lock" size={17} />
        <span>
          <small>{t("auth.signedInAs")}</small>
          <strong>{session.user.displayName}</strong>
        </span>
        {session.logoutUrl ? (
          nativeLogout ? (
            <button
              className="session-card__logout"
              data-testid={mobile ? "mobile-auth-logout" : "auth-logout"}
              type="button"
              onClick={onLogout}
              disabled={loggingOut}
            >
              {loggingOut ? t("auth.loggingOut") : t("auth.logout")}
            </button>
          ) : (
            <a
              className="session-card__logout"
              data-testid={mobile ? "mobile-auth-logout" : "auth-logout"}
              href={session.logoutUrl}
            >
              {t("auth.logout")}
            </a>
          )
        ) : null}
      </div>
    );
  }

  if (session.authRequired && session.loginUrl) {
    return (
      <div
        className={`session-card session-card--login${mobile ? " session-card--mobile" : ""}`}
        data-testid={mobile ? "mobile-auth-login" : "auth-login"}
      >
        <Icon name="lock" size={17} />
        <span>
          <small>{t("auth.required")}</small>
          <strong>{t("auth.loginRequired")}</strong>
        </span>
        <a className="session-card__logout" href={session.loginUrl}>
          {t("auth.login")}
        </a>
      </div>
    );
  }

  return null;
}

export function AppShell({
  activePage,
  onNavigate,
  onNewEntry,
  children
}: {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onNewEntry: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [showMore, setShowMore] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const {
    serverStatus,
    session,
    isLoading,
    isSaving,
    error,
    canWrite,
    reload,
    clearError
  } = useAppStore();

  const navigate = (page: PageId) => {
    setShowMore(false);
    onNavigate(page);
  };

  const logout = async () => {
    if (!session.logoutUrl) return;
    setLoggingOut(true);
    try {
      const logout = await logoutSession(session.logoutUrl);
      if (logout.logoutRedirectUrl) {
        window.location.assign(logout.logoutRedirectUrl);
        return;
      }
      await reload();
      setShowMore(false);
    } catch {
      window.location.assign(session.logoutUrl);
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => navigate("dashboard")}>
          <span className="brand__mark"><Icon name="calendar" size={22} /></span>
          <span>
            <strong>{t("app.name")}</strong>
            <small>{t("app.tagline")}</small>
          </span>
        </button>

        <nav className="sidebar__nav" aria-label={t("nav.main")}>
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              data-testid={`nav-${item.id}`}
              className={activePage === item.id ? "is-active" : ""}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar__privacy">
          <Icon name="info" size={18} />
          <p>{t("app.storageNotice")}</p>
        </div>

        <AuthSessionCard
          session={session}
          loggingOut={loggingOut}
          onLogout={() => void logout()}
          t={t}
        />

        <button
          className={`sidebar__settings ${activePage === "settings" ? "is-active" : ""}`}
          type="button"
          data-testid="nav-settings"
          onClick={() => navigate("settings")}
        >
          <Icon name="settings" />
          <span>{t("nav.settings")}</span>
        </button>
      </aside>

      <main className="main">
        <header className="mobile-header">
          <button className="brand brand--compact" type="button" onClick={() => navigate("dashboard")}>
            <span className="brand__mark"><Icon name="calendar" size={20} /></span>
            <strong>{t("app.name")}</strong>
          </button>
          <button
            className="button button--primary button--icon-mobile"
            type="button"
            data-testid="mobile-entry-create"
            onClick={onNewEntry}
            disabled={!canWrite}
            aria-label={t("action.newEntry")}
          >
            <Icon name="plus" />
            <span>{t("action.entryShort")}</span>
          </button>
        </header>
        {serverStatus === "offline" ? (
          <div
            className="offline-banner offline-banner--readonly"
            role="alert"
            aria-live="assertive"
            data-testid="offline-banner"
            data-state="readonly"
          >
            <Icon name="info" size={17} />
            <span>
              <strong>{t("status.readOnly")}</strong>{" "}
              {t("status.serverUnavailable")}
              <small
                className="offline-banner__mobile-note"
                data-testid="offline-existing-data"
              >
                {t("status.offlineExistingData")}
              </small>
            </span>
            <button className="button button--quiet" type="button" onClick={() => void reload()}>
              {t("action.retryConnection")}
            </button>
          </div>
        ) : null}
        {serverStatus === "checking" || isLoading ? (
          <div className="offline-banner" role="status" data-testid="app-loading">
            <Icon name="info" size={17} />
            {t("status.loading")}
          </div>
        ) : null}
        {serverStatus === "online" && isSaving ? (
          <div className="offline-banner" role="status">
            <Icon name="info" size={17} />
            {t("status.saving")}
          </div>
        ) : null}
        {serverStatus === "online" && error ? (
          <div className="offline-banner" role="alert">
            <Icon name="alert" size={17} />
            <span>{error}</span>
            <button className="button button--quiet" type="button" onClick={clearError}>
              {t("action.close")}
            </button>
          </div>
        ) : null}
        {children}
      </main>

      {showMore ? (
        <div className="mobile-more-backdrop" role="presentation" onClick={() => setShowMore(false)}>
          <section
            className="mobile-more-sheet"
            role="dialog"
            data-testid="mobile-more-sheet"
            aria-modal="true"
            aria-label={t("nav.moreAreas")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-more-sheet__header">
              <strong>{t("nav.moreAreas")}</strong>
              <button className="icon-button" type="button" onClick={() => setShowMore(false)} aria-label={t("nav.closeMenu")}>
                <Icon name="close" size={19} />
              </button>
            </div>
            <AuthSessionCard
              session={session}
              mobile
              loggingOut={loggingOut}
              onLogout={() => void logout()}
              t={t}
            />
            <div className="mobile-more-sheet__grid">
              {navItems
                .filter((item) => !mobileNavItems.some((mobileItem) => mobileItem.id === item.id))
                .map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    data-testid={`mobile-more-${item.id}`}
                    className={activePage === item.id ? "is-active" : ""}
                    onClick={() => navigate(item.id)}
                  >
                    <Icon name={item.icon} size={20} />
                    <span>{t(item.labelKey)}</span>
                  </button>
                ))}
              <button
                type="button"
                data-testid="mobile-more-settings"
                className={activePage === "settings" ? "is-active" : ""}
                onClick={() => navigate("settings")}
              >
                <Icon name="settings" size={20} />
                <span>{t("nav.settings")}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <nav className="mobile-nav" aria-label={t("nav.mobile")} data-testid="mobile-navigation">
        {mobileNavItems.map((item) => (
          <button
            type="button"
            key={item.id}
            data-testid={`mobile-nav-${item.id}`}
            className={activePage === item.id ? "is-active" : ""}
            onClick={() => navigate(item.id)}
          >
            <Icon name={item.icon} size={19} />
            <span>{t(item.labelKey)}</span>
          </button>
        ))}
        <button
          type="button"
          data-testid="mobile-nav-more"
          className={showMore || !mobileNavItems.some((item) => item.id === activePage) ? "is-active" : ""}
          onClick={() => setShowMore((current) => !current)}
          aria-expanded={showMore}
          aria-label={t("nav.openMore")}
        >
          <Icon name="list" size={19} />
          <span>{t("nav.more")}</span>
        </button>
      </nav>
    </div>
  );
}
