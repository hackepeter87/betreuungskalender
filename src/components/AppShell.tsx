import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { TranslationKey } from "../i18n/resources";
import { logoutSession } from "../lib/api";
import { useAppStore } from "../store/AppStore";
import type { ApiSession } from "../../shared/api";
import type { CareEntry } from "../types";
import { catalogKey, copy } from "../i18n/catalog";
import { CareConfirmationCenter } from "./CareConfirmationCenter";
import type { IconName } from "./Icon";
import { Icon } from "./Icon";
import { useDialogFocus } from "../hooks/useDialogFocus";

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

export function canAccessPage(session: ApiSession, page: PageId): boolean {
  if (!session.permissions) return true;
  const has = (permission: NonNullable<ApiSession["permissions"]>[number]) =>
    session.permissions?.includes(permission) ?? false;
  if (["dashboard", "calendar", "entries", "rules"].includes(page)) {
    return has("appointments:view");
  }
  if (["contact", "holidays", "unavailable"].includes(page)) {
    return has("planning:view");
  }
  if (["analytics", "report"].includes(page)) return has("reports:view");
  if (page === "backup") return has("exports:run");
  if (page === "audit") return has("audit:view");
  if (page === "settings") {
    return [
      "settings:view",
      "members:manage",
      "notifications:manage-own",
      "feeds:manage-own"
    ].some((permission) => has(permission as NonNullable<ApiSession["permissions"]>[number]));
  }
  return false;
}

const sidebarCollapsedStorageKey = "betreuungskalender.sidebarCollapsed";

function LegalLinks({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <nav className={`app-legal-links${compact ? " app-legal-links--compact" : ""}`} aria-label={t("legal.links")}>
      <a href="/impressum">{t("legal.notice")}</a>
      <a href="/datenschutz">{t("legal.privacy")}</a>
    </nav>
  );
}

function AuthSessionCard({
  session,
  mobile = false,
  compact = false,
  testIdPrefix,
  loggingOut,
  onLogout,
  t
}: {
  session: ApiSession;
  mobile?: boolean;
  compact?: boolean;
  testIdPrefix?: string;
  loggingOut: boolean;
  onLogout: () => void;
  t: (key: TranslationKey) => string;
}) {
  const testId = (name: "auth-session" | "auth-logout" | "auth-login") =>
    testIdPrefix ? `${testIdPrefix}-${name}` : mobile ? `mobile-${name}` : name;

  if (session.authenticated && session.user) {
    const nativeLogout = session.logoutUrl === "/auth/logout";
    return (
      <div
        className={`session-card${mobile ? " session-card--mobile" : ""}${compact ? " session-card--compact" : ""}`}
        data-testid={testId("auth-session")}
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
              data-testid={testId("auth-logout")}
              type="button"
              onClick={onLogout}
              disabled={loggingOut}
            >
              {loggingOut ? t("auth.loggingOut") : t("auth.logout")}
            </button>
          ) : (
            <a
              className="session-card__logout"
              data-testid={testId("auth-logout")}
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
        className={`session-card session-card--login${mobile ? " session-card--mobile" : ""}${compact ? " session-card--compact" : ""}`}
        data-testid={testId("auth-login")}
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

function MobileAuthMenu({
  session,
  loggingOut,
  onLogout,
  t
}: {
  session: ApiSession;
  loggingOut: boolean;
  onLogout: () => void;
  t: (key: TranslationKey) => string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const nativeLogout = session.authenticated && session.logoutUrl === "/auth/logout";

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (session.authenticated && session.user) {
    return (
      <div className="auth-menu" ref={menuRef}>
        <button
          className="auth-menu__trigger"
          type="button"
          data-testid="mobile-auth-session"
          aria-label={t("auth.userMenu")}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((current) => !current)}
        >
          <Icon name="user" size={21} />
        </button>
        {open ? (
          <div className="auth-menu__popover" role="menu" data-testid="mobile-auth-menu">
            <div className="auth-menu__identity" role="presentation">
              <small>{t("auth.signedInAs")}</small>
              <strong>{session.user.displayName}</strong>
              <span>{session.workspaceRole ?? session.user.role}</span>
            </div>
            {session.logoutUrl ? (
              nativeLogout ? (
                <button
                  className="auth-menu__action"
                  data-testid="mobile-auth-logout"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onLogout();
                  }}
                  disabled={loggingOut}
                >
                  {loggingOut ? t("auth.loggingOut") : t("auth.logout")}
                </button>
              ) : (
                <a
                  className="auth-menu__action"
                  data-testid="mobile-auth-logout"
                  role="menuitem"
                  href={session.logoutUrl}
                  onClick={() => setOpen(false)}
                >
                  {t("auth.logout")}
                </a>
              )
            ) : null}
            <a className="auth-menu__action" role="menuitem" href="/impressum">
              {t("legal.notice")}
            </a>
            <a className="auth-menu__action" role="menuitem" href="/datenschutz">
              {t("legal.privacy")}
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  if (session.authRequired && session.loginUrl) {
    return (
      <a
        className="auth-menu__trigger"
        data-testid="mobile-auth-login"
        href={session.loginUrl}
        aria-label={t("auth.login")}
      >
        <Icon name="user" size={21} />
      </a>
    );
  }

  return null;
}

function NotificationBell({
  testIdPrefix,
  onOpenEntry
}: {
  testIdPrefix: "sidebar" | "mobile";
  onOpenEntry: (entry: CareEntry) => void;
}) {
  const { locale } = useI18n();
  const { openConfirmations, session } = useAppStore();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const count = openConfirmations.length;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!session.permissions?.includes("notifications:manage-own") && session.permissions) return null;

  return (
    <div className="notification-center" ref={popoverRef}>
      <button
        className={`notification-center__trigger${count ? " has-notifications" : ""}`}
        type="button"
        data-testid={`${testIdPrefix}-notification-center-trigger`}
        aria-label={copy(locale, "confirmation", "notificationCenterAria", { count })}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="bell" size={20} />
        {testIdPrefix === "sidebar" ? (
          <span className="notification-center__label">
            {copy(locale, "confirmation", "notificationCenterShort")}
          </span>
        ) : null}
        {count ? <span className="notification-center__badge" data-testid={`${testIdPrefix}-notification-center-badge`}>{count > 9 ? "9+" : count}</span> : null}
      </button>
      {open ? (
        <section
          className="notification-center__popover"
          role="dialog"
          aria-label={copy(locale, "confirmation", "notificationCenter")}
          data-testid={`${testIdPrefix}-notification-center-popover`}
        >
          <header className="notification-center__header">
            <div>
              <strong>{copy(locale, "confirmation", "notificationCenter")}</strong>
              <p>{copy(locale, "confirmation", catalogKey("confirmation", count ? "notificationCenterDescription" : "empty"))}</p>
            </div>
            <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label={copy(locale, "common", "cancel")}>
              <Icon name="close" size={18} />
            </button>
          </header>
          <CareConfirmationCenter
            compact
            onOpenEntry={(entry) => {
              setOpen(false);
              onOpenEntry(entry);
            }}
          />
        </section>
      ) : null}
    </div>
  );
}

export function AppShell({
  activePage,
  onNavigate,
  onNewEntry,
  onOpenEntry,
  setupMode = false,
  children
}: {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onNewEntry: () => void;
  onOpenEntry: (entry: CareEntry) => void;
  setupMode?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [showMore, setShowMore] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeMore = useCallback(() => setShowMore(false), []);
  const moreDialogRef = useDialogFocus<HTMLElement>(closeMore, showMore, moreTriggerRef);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(sidebarCollapsedStorageKey) === "true";
    } catch {
      return false;
    }
  });
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
    if (!canAccessPage(session, page)) return;
    setShowMore(false);
    onNavigate(page);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(sidebarCollapsedStorageKey, sidebarCollapsed ? "true" : "false");
    } catch {
      // Local UI preference only; failure should not affect navigation.
    }
  }, [sidebarCollapsed]);

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
    <div className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`} data-testid="app-shell">
      <aside className={`sidebar${sidebarCollapsed ? " sidebar--collapsed" : ""}`}>
        <div className="sidebar__header">
          <button className="brand" type="button" onClick={() => navigate("dashboard")} aria-label={t("app.name")}>
            <span className="brand__mark">
              <img className="brand__logo" src="/icons/app-logo-nav.svg" alt="" data-testid="desktop-app-logo" />
            </span>
            <span>
              <strong>{t("app.name")}</strong>
              <small>{t("app.tagline")}</small>
            </span>
          </button>
        </div>

        {!setupMode ? (
          <>
            <nav className="sidebar__nav" aria-label={t("nav.main")}>
              {navItems.filter((item) => canAccessPage(session, item.id)).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  data-testid={`nav-${item.id}`}
                  className={activePage === item.id ? "is-active" : ""}
                  onClick={() => navigate(item.id)}
                  aria-label={t(item.labelKey).replaceAll("\u00ad", "")}
                  title={sidebarCollapsed ? t(item.labelKey).replaceAll("\u00ad", "") : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{t(item.labelKey)}</span>
                </button>
              ))}
            </nav>

            <NotificationBell testIdPrefix="sidebar" onOpenEntry={onOpenEntry} />
          </>
        ) : null}

        <div className="sidebar__footer">
          {!setupMode && canAccessPage(session, "settings") ? (
            <button
              className={`sidebar__settings ${activePage === "settings" ? "is-active" : ""}`}
              type="button"
              data-testid="nav-settings"
              onClick={() => navigate("settings")}
              aria-label={t("nav.settings")}
              title={sidebarCollapsed ? t("nav.settings") : undefined}
            >
              <Icon name="settings" />
              <span>{t("nav.settings")}</span>
            </button>
          ) : null}

          {!setupMode ? (
            <button
              className="sidebar__collapse-control"
              type="button"
              data-testid="sidebar-collapse-control"
              aria-label={t(sidebarCollapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}
              aria-pressed={sidebarCollapsed}
              title={t(sidebarCollapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}
              onClick={() => setSidebarCollapsed((current) => !current)}
            >
              <Icon name={sidebarCollapsed ? "chevronRight" : "chevronLeft"} size={18} />
              <span>{t(sidebarCollapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}</span>
            </button>
          ) : null}

          {sidebarCollapsed && !setupMode ? (
            <div className="sidebar__collapsed-auth">
              <MobileAuthMenu
                session={session}
                loggingOut={loggingOut}
                onLogout={() => void logout()}
                t={t}
              />
            </div>
          ) : (
            <AuthSessionCard
              session={session}
              loggingOut={loggingOut}
              onLogout={() => void logout()}
              t={t}
            />
          )}
          {!sidebarCollapsed ? <LegalLinks /> : null}
        </div>
      </aside>

      {!setupMode ? <nav className="mobile-nav" aria-label={t("nav.mobile")} data-testid="mobile-navigation">
        {mobileNavItems.filter((item) => canAccessPage(session, item.id)).map((item) => (
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
          ref={moreTriggerRef}
          type="button"
          data-testid="mobile-nav-more"
          className={showMore || !mobileNavItems.filter((item) => canAccessPage(session, item.id)).some((item) => item.id === activePage) ? "is-active" : ""}
          onClick={() => setShowMore((current) => !current)}
          aria-expanded={showMore}
          aria-controls="mobile-more-sheet"
          aria-label={t("nav.openMore")}
        >
          <Icon name="list" size={19} />
          <span>{t("nav.more")}</span>
        </button>
      </nav> : null}

      <main className="main">
        <header className="mobile-header">
          <button className="brand brand--compact" type="button" onClick={() => navigate("dashboard")}>
            <span className="brand__mark">
              <img className="brand__logo" src="/icons/app-logo-nav.svg" alt="" data-testid="mobile-app-logo" />
            </span>
            <strong>{t("app.name")}</strong>
          </button>
          <div className="mobile-header__actions">
            {!setupMode ? <NotificationBell testIdPrefix="mobile" onOpenEntry={onOpenEntry} /> : null}
            <MobileAuthMenu
              session={session}
              loggingOut={loggingOut}
              onLogout={() => void logout()}
              t={t}
            />
            {!setupMode && activePage !== "calendar" ? (
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
            ) : null}
          </div>
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

      {showMore && !setupMode ? (
        <div className="mobile-more-backdrop" role="presentation" onClick={closeMore}>
          <section
            ref={moreDialogRef}
            id="mobile-more-sheet"
            className="mobile-more-sheet"
            role="dialog"
            data-testid="mobile-more-sheet"
            aria-modal="true"
            aria-label={t("nav.moreAreas")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-more-sheet__header">
              <strong>{t("nav.moreAreas")}</strong>
              <button className="icon-button" type="button" onClick={closeMore} aria-label={t("nav.closeMenu")}>
                <Icon name="close" size={19} />
              </button>
            </div>
            <AuthSessionCard
              session={session}
              mobile
              testIdPrefix="mobile-more"
              loggingOut={loggingOut}
              onLogout={() => void logout()}
              t={t}
            />
            <div className="mobile-more-sheet__grid">
              {navItems
                .filter((item) => !mobileNavItems.some((mobileItem) => mobileItem.id === item.id))
                .filter((item) => canAccessPage(session, item.id))
                .map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    data-testid={`mobile-more-${item.id}`}
                    aria-label={t(item.labelKey).replaceAll("\u00ad", "")}
                    className={activePage === item.id ? "is-active" : ""}
                    onClick={() => navigate(item.id)}
                  >
                    <Icon name={item.icon} size={20} />
                    <span>{t(item.labelKey)}</span>
                  </button>
                ))}
              {canAccessPage(session, "settings") ? <button
                type="button"
                data-testid="mobile-more-settings"
                className={activePage === "settings" ? "is-active" : ""}
                onClick={() => navigate("settings")}
              >
                <Icon name="settings" size={20} />
                <span>{t("nav.settings")}</span>
              </button> : null}
            </div>
            <LegalLinks compact />
          </section>
        </div>
      ) : null}

    </div>
  );
}
