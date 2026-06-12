import { useDeferredValue, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { formatDateTime } from "../lib/date";
import { useAppStore } from "../store/AppStore";
import type { AuditAction, AuditObjectType } from "../types";

const objectLabels: Record<AuditObjectType, string> = {
  careEntry: "Betreuungseintrag",
  trip: "Fahrt",
  cost: "Kosten",
  holiday: "Ferien",
  unavailablePeriod: "Nichtverfügbarkeit",
  child: "Kind",
  contactPattern: "Umgangsregel",
  settings: "Einstellungen",
  monthClosure: "Monatsabschluss",
  appData: "Datenbestand",
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
  const [objectType, setObjectType] = useState<AuditObjectType | "all">("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("de"));
  const entries = useMemo(
    () =>
      data.auditLog
        .filter((entry) => objectType === "all" || entry.objectType === objectType)
        .filter((entry) => {
          if (!deferredQuery) return true;
          return `${entry.objectLabel} ${entry.field} ${entry.oldValue} ${entry.newValue}`
            .toLocaleLowerCase("de")
            .includes(deferredQuery);
        })
        .slice()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [data.auditLog, deferredQuery, objectType]
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="page-header__context">Nachvollziehbarkeit</p>
          <h1>Änderungsprotokoll</h1>
        </div>
      </div>

      <section className="notice">
        <Icon name="history" />
        <p>Änderungen an Betreuungseinträgen, Fahrten, Kosten, Ferien und Nichtverfügbarkeiten werden in SQLite feldweise protokolliert. Löschungen bleiben als Protokolleintrag erhalten.</p>
      </section>

      <section className="panel">
        <div className="list-toolbar">
          <label className="search-field">
            <span className="sr-only">Protokoll durchsuchen</span>
            <Icon name="list" size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Objekt, Feld oder Wert suchen" />
          </label>
          <FieldHelpButton fieldId="audit.search" />
          <label className="field audit-filter">
            <FieldHelpLabel fieldId="audit.objectType" />
            <select value={objectType} onChange={(event) => setObjectType(event.target.value as AuditObjectType | "all")}>
              <option value="all">Alle</option>
              {Object.entries(objectLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="stats-table audit-table responsive-table">
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Objekt</th>
                <th>Vorgang</th>
                <th>Feld</th>
                <th>Alter Wert</th>
                <th>Neuer Wert</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="Zeitpunkt">{formatDateTime(entry.timestamp)}</td>
                  <td data-label="Objekt"><strong>{objectLabels[entry.objectType]}</strong><small>{entry.objectLabel}</small></td>
                  <td data-label="Vorgang"><span className={`audit-action audit-action--${entry.action}`}>{actionLabels[entry.action]}</span></td>
                  <td data-label="Feld">{entry.field}</td>
                  <td data-label="Alter Wert">{entry.oldValue}</td>
                  <td data-label="Neuer Wert">{entry.newValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 ? <p className="empty-copy empty-copy--padded">Keine passenden Änderungen protokolliert.</p> : null}
      </section>
    </div>
  );
}
