import { useDeferredValue, useMemo, useState } from "react";
import { EntryRow } from "../components/EntryRow";
import { Icon } from "../components/Icon";
import { FieldHelpButton } from "../components/FieldHelp";
import { MonthToolbar } from "../components/MonthToolbar";
import { entriesForMonth } from "../lib/analytics";
import { formatMonth } from "../lib/date";
import { useAppStore } from "../store/AppStore";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { statusLabel } from "../lib/labels";
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
  const { locale, intlLocale } = useI18n();
  const [status, setStatus] = useState<EntryStatus | "all">("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.toLocaleLowerCase(intlLocale));
  const entries = useMemo(() => {
    return entriesForMonth(data.entries, monthKey)
      .filter((entry) => status === "all" || entry.status === status)
      .filter((entry) => {
        if (!deferredQuery) return true;
        const childNames = entry.childIds
          .map((id) => data.children.find((child) => child.id === id)?.name ?? "")
          .join(" ");
        return `${childNames} ${entry.notes ?? ""} ${entry.cancellationReason ?? ""}`
          .toLocaleLowerCase(intlLocale)
          .includes(deferredQuery);
      })
      .slice()
      .sort((a, b) => b.startDateTime.localeCompare(a.startDateTime));
  }, [data.children, data.entries, deferredQuery, intlLocale, monthKey, status]);

  return (
    <div className="page" data-testid="page-entries">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "entries", "context")}</p>
          <h1>{copy(locale, "entries", "title", { month: formatMonth(monthKey, intlLocale) })}</h1>
        </div>
        <div className="page-header__actions">
          <MonthToolbar monthKey={monthKey} onChange={onMonthChange} />
          <button className="button button--primary desktop-only" type="button" onClick={onNewEntry} disabled={!canWrite}>
            <Icon name="plus" />
            {copy(locale, "entries", "createEntry")}
          </button>
        </div>
      </div>

      <section className="panel">
        <div className="list-toolbar">
          <label className="search-field">
            <span className="sr-only">{copy(locale, "entries", "searchAria")}</span>
            <Icon name="list" size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy(locale, "entries", "searchPlaceholder")} />
          </label>
          <FieldHelpButton fieldId="entries.search" />
          <div className="segmented-control">
            {(
              [
                ["all", copy(locale, "entries", "all")],
                ["completed", statusLabel("completed", locale)],
                ["planned", statusLabel("planned", locale)],
                ["cancelled", statusLabel("cancelled", locale)]
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
              <h2>{copy(locale, "entries", "emptyTitle")}</h2>
              <p>{copy(locale, "entries", "emptyDescription")}</p>
              <button className="button button--primary" type="button" onClick={onNewEntry} disabled={!canWrite}>
                <Icon name="plus" size={17} />
                {copy(locale, "entries", "createEntry")}
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
