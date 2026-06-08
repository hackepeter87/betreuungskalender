import { useState, type ReactNode } from "react";
import { SERVER_UNAVAILABLE_MESSAGE } from "../lib/api";
import { useAppStore } from "../store/AppStore";
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

const navItems: Array<{ id: PageId; label: string; icon: IconName }> = [
  { id: "dashboard", label: "Übersicht", icon: "home" },
  { id: "calendar", label: "Kalender", icon: "calendar" },
  { id: "entries", label: "Einträge", icon: "list" },
  { id: "contact", label: "Umgang", icon: "repeat" },
  { id: "holidays", label: "Ferien", icon: "sun" },
  { id: "unavailable", label: "Nichtverfügbarkeit", icon: "briefcase" },
  { id: "analytics", label: "Auswertung", icon: "chart" },
  { id: "report", label: "Bericht", icon: "fileText" },
  { id: "backup", label: "Backup", icon: "backup" },
  { id: "audit", label: "Protokoll", icon: "history" },
  { id: "rules", label: "Regeln", icon: "book" }
];

const mobileNavItems = navItems.filter((item) =>
  ["dashboard", "calendar", "entries", "analytics"].includes(item.id)
);

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
  const [showMore, setShowMore] = useState(false);
  const {
    serverStatus,
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => navigate("dashboard")}>
          <span className="brand__mark"><Icon name="calendar" size={22} /></span>
          <span>
            <strong>Betreuungskalender</strong>
            <small>Fakten lokal dokumentieren.</small>
          </span>
        </button>

        <nav className="sidebar__nav" aria-label="Hauptnavigation">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={activePage === item.id ? "is-active" : ""}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar__privacy">
          <Icon name="info" size={18} />
          <p>Fachliche Daten werden im lokalen SQLite-Dienst gespeichert.</p>
        </div>

        <button
          className={`sidebar__settings ${activePage === "settings" ? "is-active" : ""}`}
          type="button"
          onClick={() => navigate("settings")}
        >
          <Icon name="settings" />
          <span>Einstellungen</span>
        </button>
      </aside>

      <main className="main">
        <header className="mobile-header">
          <button className="brand brand--compact" type="button" onClick={() => navigate("dashboard")}>
            <span className="brand__mark"><Icon name="calendar" size={20} /></span>
            <strong>Betreuungskalender</strong>
          </button>
          <button
            className="button button--primary button--icon-mobile"
            type="button"
            onClick={onNewEntry}
            disabled={!canWrite}
            aria-label="Eintrag erfassen"
          >
            <Icon name="plus" />
            <span>Eintrag</span>
          </button>
        </header>
        {serverStatus === "offline" ? (
          <div className="offline-banner" role="status">
            <Icon name="info" size={17} />
            <span>{SERVER_UNAVAILABLE_MESSAGE}</span>
            <button className="button button--quiet" type="button" onClick={() => void reload()}>
              Erneut verbinden
            </button>
          </div>
        ) : null}
        {serverStatus === "checking" || isLoading ? (
          <div className="offline-banner" role="status">
            <Icon name="info" size={17} />
            Daten werden aus SQLite geladen …
          </div>
        ) : null}
        {serverStatus === "online" && isSaving ? (
          <div className="offline-banner" role="status">
            <Icon name="info" size={17} />
            Änderungen werden gespeichert …
          </div>
        ) : null}
        {serverStatus === "online" && error ? (
          <div className="offline-banner" role="alert">
            <Icon name="alert" size={17} />
            <span>{error}</span>
            <button className="button button--quiet" type="button" onClick={clearError}>
              Schließen
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
            aria-modal="true"
            aria-label="Weitere Bereiche"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-more-sheet__header">
              <strong>Weitere Bereiche</strong>
              <button className="icon-button" type="button" onClick={() => setShowMore(false)} aria-label="Menü schließen">
                <Icon name="close" size={19} />
              </button>
            </div>
            <div className="mobile-more-sheet__grid">
              {navItems
                .filter((item) => !mobileNavItems.some((mobileItem) => mobileItem.id === item.id))
                .map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={activePage === item.id ? "is-active" : ""}
                    onClick={() => navigate(item.id)}
                  >
                    <Icon name={item.icon} size={20} />
                    <span>{item.label}</span>
                  </button>
                ))}
              <button
                type="button"
                className={activePage === "settings" ? "is-active" : ""}
                onClick={() => navigate("settings")}
              >
                <Icon name="settings" size={20} />
                <span>Einstellungen</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <nav className="mobile-nav" aria-label="Mobile Navigation">
        {mobileNavItems.map((item) => (
          <button
            type="button"
            key={item.id}
            className={activePage === item.id ? "is-active" : ""}
            onClick={() => navigate(item.id)}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={showMore || !mobileNavItems.some((item) => item.id === activePage) ? "is-active" : ""}
          onClick={() => setShowMore((current) => !current)}
          aria-expanded={showMore}
          aria-label="Weitere Bereiche öffnen"
        >
          <Icon name="list" size={19} />
          <span>Mehr</span>
        </button>
      </nav>
    </div>
  );
}
