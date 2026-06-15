import { useDeferredValue, useMemo, useState } from "react";
import { EntryRow } from "../components/EntryRow";
import { Icon } from "../components/Icon";
import { FieldHelpButton } from "../components/FieldHelp";
import { MonthToolbar } from "../components/MonthToolbar";
import { entriesForMonth } from "../lib/analytics";
import { formatMonth } from "../lib/date";
import { useAppStore } from "../store/AppStore";
import type { CareEntry, EntryStatus } from "../types";

export function EntriesPage({
  monthKey,
  onMonthChange,
  onNewEntry,
  onEditEntry
}: {
  monthKey: string;
  onMonthChange: (month: string) => void;
  onNewEntry: () => void;
  onEditEntry: (entry: CareEntry) => void;
}) {
  const { data, canWrite } = useAppStore();
  const [status, setStatus] = useState<EntryStatus | "all">("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.toLocaleLowerCase("de"));
  const entries = useMemo(() => {
    return entriesForMonth(data.entries, monthKey)
      .filter((entry) => status === "all" || entry.status === status)
      .filter((entry) => {
        if (!deferredQuery) return true;
        const childNames = entry.childIds
          .map((id) => data.children.find((child) => child.id === id)?.name ?? "")
          .join(" ");
        return `${childNames} ${entry.notes ?? ""} ${entry.cancellationReason ?? ""}`
          .toLocaleLowerCase("de")
          .includes(deferredQuery);
      })
      .slice()
      .sort((a, b) => b.startDateTime.localeCompare(a.startDateTime));
  }, [data.children, data.entries, deferredQuery, monthKey, status]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="page-header__context">Dokumentation</p>
          <h1>Einträge · {formatMonth(monthKey)}</h1>
        </div>
        <div className="page-header__actions">
          <MonthToolbar monthKey={monthKey} onChange={onMonthChange} />
          <button className="button button--primary desktop-only" type="button" onClick={onNewEntry} disabled={!canWrite}>
            <Icon name="plus" />
            Eintrag erfassen
          </button>
        </div>
      </div>

      <section className="panel">
        <div className="list-toolbar">
          <label className="search-field">
            <span className="sr-only">Einträge durchsuchen</span>
            <Icon name="list" size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name oder Notiz suchen" />
          </label>
          <FieldHelpButton fieldId="entries.search" />
          <div className="segmented-control">
            {(
              [
                ["all", "Alle"],
                ["completed", "Durchgeführt"],
                ["planned", "Geplant"],
                ["cancelled", "Ausgefallen"]
              ] as Array<[EntryStatus | "all", string]>
            ).map(([value, label]) => (
              <button type="button" key={value} className={status === value ? "is-active" : ""} onClick={() => setStatus(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="entry-list">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} children={data.children} onClick={() => onEditEntry(entry)} />
          ))}
          {entries.length === 0 ? (
            <div className="empty-state">
              <span><Icon name="list" size={25} /></span>
              <h2>Keine passenden Einträge</h2>
              <p>Erfasse einen Betreuungseintrag oder ändere die Filter.</p>
              <button className="button button--primary" type="button" onClick={onNewEntry} disabled={!canWrite}>
                <Icon name="plus" size={17} />
                Eintrag erfassen
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
