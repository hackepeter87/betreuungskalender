import { useDeferredValue, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { formatDateTime } from "../lib/date";
import { useAppStore } from "../store/AppStore";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import type { AuditAction, AuditObjectType } from "../types";

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
  const { data } = useAppStore();
  const { locale, intlLocale } = useI18n();
  const [objectType, setObjectType] = useState<AuditObjectType | "all">("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(intlLocale));
  const entries = useMemo(
    () =>
      data.auditLog
        .filter((entry) => objectType === "all" || entry.objectType === objectType)
        .filter((entry) => {
          if (!deferredQuery) return true;
          return `${entry.objectLabel} ${entry.field} ${entry.oldValue} ${entry.newValue}`
            .toLocaleLowerCase(intlLocale)
            .includes(deferredQuery);
        })
        .slice()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [data.auditLog, deferredQuery, intlLocale, objectType]
  );

  return (
    <div className="page">
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
              {entries.map((entry) => (
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
        {entries.length === 0 ? <p className="empty-copy empty-copy--padded">{copy(locale, "audit", "empty")}</p> : null}
      </section>
    </div>
  );
}
