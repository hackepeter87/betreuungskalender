import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { formatDateTime } from "../lib/date";
import { api } from "../lib/api";
import { useI18n } from "../i18n/I18nProvider";
import { catalogKey, copy } from "../i18n/catalog";
import type { AuditAction, AuditLogEntry, AuditObjectType } from "../types";

const objectLabels: Record<AuditObjectType, string> = {
  careEntry: "Betreuungseintrag",
  trip: "Fahrt",
  cost: "Kosten",
  holiday: "Ferien",
  unavailablePeriod: "Nichtverfügbarkeit",
  child: "Kind",
  careParty: "Betreuende Person",
  contactPattern: "Umgangsregel",
  settings: "Einstellungen",
  monthClosure: "Monatsabschluss",
  appData: "Datenbestand",
  userCarePartyAssignment: "Nutzer-Zuordnung",
  legacyMigration: "Legacy-Migration"
};

const actionLabels: Record<AuditAction, string> = {
  created: "Erstellt",
  updated: "Geändert",
  deleted: "Gelöscht",
  postCloseChange: "Nach Abschluss geändert"
};

export function AuditLogPage() {
  const { locale, intlLocale } = useI18n();
  const [objectType, setObjectType] = useState<AuditObjectType | "all">("all");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);
  const pageGeneration = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++pageGeneration.current;
    setEntries([]);
    setNextCursor(undefined);
    setLoadError(false);
    setIsLoading(true);
    setIsLoadingMore(false);
    void api.listAuditPage({
      objectType: objectType === "all" ? undefined : objectType,
      signal: controller.signal
    }).then((page) => {
      if (pageGeneration.current !== generation) return;
      setEntries(page.items);
      setNextCursor(page.nextCursor);
    }).catch((error: unknown) => {
      if (
        pageGeneration.current === generation &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setLoadError(true);
      }
    }).finally(() => {
      if (pageGeneration.current === generation && !controller.signal.aborted) {
        setIsLoading(false);
      }
    });
    return () => controller.abort();
  }, [objectType, reloadRevision]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    const generation = pageGeneration.current;
    setIsLoadingMore(true);
    setLoadError(false);
    try {
      const page = await api.listAuditPage({
        objectType: objectType === "all" ? undefined : objectType,
        cursor: nextCursor
      });
      if (pageGeneration.current !== generation) return;
      setEntries((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      if (pageGeneration.current === generation) setLoadError(true);
    } finally {
      if (pageGeneration.current === generation) setIsLoadingMore(false);
    }
  };

  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(intlLocale));
  const visibleEntries = useMemo(
    () =>
      entries
        .filter((entry) => {
          if (!deferredQuery) return true;
          return `${entry.objectLabel} ${entry.field} ${entry.oldValue} ${entry.newValue}`
            .toLocaleLowerCase(intlLocale)
            .includes(deferredQuery);
        })
        .slice()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [deferredQuery, entries, intlLocale]
  );

  return (
    <div className="page" data-testid="page-audit">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "audit", "context")}</p>
          <h1>{copy(locale, "audit", "title")}</h1>
        </div>
      </div>

      <section className="notice">
        <Icon name="history" />
        <p>{copy(locale, "audit", "description")}</p>
      </section>

      <section className="panel">
        <div className="list-toolbar">
          <label className="search-field">
            <span className="sr-only">{copy(locale, "audit", "search")}</span>
            <Icon name="list" size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy(locale, "audit", "placeholder")} />
          </label>
          <FieldHelpButton fieldId="audit.search" />
          <label className="field audit-filter">
            <FieldHelpLabel fieldId="audit.objectType" />
            <select value={objectType} onChange={(event) => setObjectType(event.target.value as AuditObjectType | "all")}>
              <option value="all">{copy(locale, "audit", "all")}</option>
              {Object.entries(objectLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="stats-table audit-table responsive-table">
            <thead>
              <tr>
                <th>{copy(locale, "audit", "timestamp")}</th>
                <th>{copy(locale, "audit", "actor")}</th>
                <th>{copy(locale, "audit", "object")}</th>
                <th>{copy(locale, "audit", "action")}</th>
                <th>{copy(locale, "audit", "field")}</th>
                <th>{copy(locale, "audit", "oldValue")}</th>
                <th>{copy(locale, "audit", "newValue")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr key={entry.id}>
                  <td data-label={copy(locale, "audit", "timestamp")}>{formatDateTime(entry.timestamp, intlLocale)}</td>
                  <td data-label={copy(locale, "audit", "actor")}><strong>{entry.userDisplayName ?? entry.userId}</strong><small>{entry.userId}</small></td>
                  <td data-label={copy(locale, "audit", "object")}><strong>{objectLabels[entry.objectType]}</strong><small>{entry.objectLabel}</small></td>
                  <td data-label={copy(locale, "audit", "action")}><span className={`audit-action audit-action--${entry.action}`}>{actionLabels[entry.action]}</span></td>
                  <td data-label={copy(locale, "audit", "field")}>{entry.field}</td>
                  <td data-label={copy(locale, "audit", "oldValue")}>{entry.oldValue}</td>
                  <td data-label={copy(locale, "audit", "newValue")}>{entry.newValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isLoading ? (
          <p className="empty-copy empty-copy--padded" role="status" aria-live="polite">
            {copy(locale, "audit", "loading")}
          </p>
        ) : null}
        {loadError ? (
          <div className="notice notice--warning" role="alert">
            <Icon name="alert" />
            <p>{copy(locale, "audit", "loadError")}</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setReloadRevision((value) => value + 1)}
            >
              {copy(locale, "audit", "retry")}
            </button>
          </div>
        ) : null}
        {!isLoading && !loadError && visibleEntries.length === 0 ? (
          <p className="empty-copy empty-copy--padded">{copy(locale, "audit", "empty")}</p>
        ) : null}
        {nextCursor && !isLoading && !loadError ? (
          <div className="form-actions">
            <button
              className="button button--secondary"
              data-testid="audit-load-more"
              type="button"
              disabled={isLoadingMore}
              onClick={() => void loadMore()}
            >
              {copy(locale, "audit", catalogKey("audit", isLoadingMore ? "loadingMore" : "loadMore"))}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
