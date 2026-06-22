import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { useAppStore } from "../store/AppStore";
import { Icon } from "./Icon";

const DEFAULT_COLOR = "#2563eb";

export function ExternalCalendarManager() {
  const { data, reload, canWrite, isSaving } = useAppStore();
  const { locale, intlLocale } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [message, setMessage] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const readFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".ics")) throw new Error(copy(locale, "externalCalendar", "invalid"));
    return file.text();
  };
  const importFile = async (file?: File, sourceId?: string) => {
    if (!file || !name.trim()) return;
    try {
      const content = await readFile(file);
      const result = sourceId
        ? await api.replaceExternalCalendar(sourceId, { name: name.trim(), color, content })
        : await api.importExternalCalendar({ name: name.trim(), color, content });
      setMessage(copy(locale, "externalCalendar", "imported", { count: result.importedEvents }));
      setName("");
      await reload();
    } catch {
      setMessage(copy(locale, "externalCalendar", "invalid"));
    }
  };

  return <section className="panel settings-section" data-testid="external-calendar-manager">
    <div className="panel__header panel__header--compact"><div><h2>{copy(locale, "externalCalendar", "title")}</h2><p>{copy(locale, "externalCalendar", "description")}</p></div></div>
    <div className="settings-form-grid">
      <label className="field"><span>{copy(locale, "externalCalendar", "sourceName")}</span><input data-testid="external-calendar-name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field"><span>{copy(locale, "externalCalendar", "color")}</span><input data-testid="external-calendar-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      <label className="field"><span>{copy(locale, "externalCalendar", "file")}</span><input ref={inputRef} type="file" accept=".ics,text/calendar" data-testid="external-calendar-file" onChange={(event) => { if (replacingId) void importFile(event.target.files?.[0], replacingId).finally(() => setReplacingId(null)); }} /></label>
    </div>
    <button className="button button--primary" type="button" data-testid="external-calendar-import" disabled={!canWrite || isSaving || !name.trim()} onClick={() => void importFile(inputRef.current?.files?.[0])}><Icon name="upload" size={17} />{copy(locale, "externalCalendar", "import")}</button>
    {message ? <p className="inline-message" role="status" data-testid="external-calendar-message">{message}</p> : null}
    <div className="child-settings-list">
      {data.externalCalendarSources.map((source) => <div className="child-settings-row" key={source.id} data-testid={`external-calendar-source-${source.id}`}>
        <span className="child-avatar" style={{ backgroundColor: `${source.color}18`, color: source.color }}><Icon name="calendar" size={18} /></span>
        <span><strong>{source.name}</strong><small>{new Date(source.lastImportedAt).toLocaleString(intlLocale)}</small></span>
        <span className="child-settings-row__actions">
          <label className="toggle" data-testid={`external-calendar-visible-control-${source.id}`}><input data-testid={`external-calendar-visible-${source.id}`} type="checkbox" checked={source.visible} disabled={!canWrite || isSaving} onChange={(event) => void api.updateExternalCalendar(source.id, { visible: event.target.checked }).then(reload)} /><span />{copy(locale, "externalCalendar", "visible")}</label>
          <button className="button button--secondary" type="button" data-testid={`external-calendar-replace-${source.id}`} disabled={!canWrite || isSaving} onClick={() => { setName(source.name); setColor(source.color); setReplacingId(source.id); inputRef.current?.click(); }}>{copy(locale, "externalCalendar", "replace")}</button>
          <button className="icon-button icon-button--danger" data-testid={`external-calendar-delete-${source.id}`} aria-label={copy(locale, "externalCalendar", "delete")} type="button" disabled={!canWrite || isSaving} onClick={() => { if (window.confirm(copy(locale, "externalCalendar", "deleteConfirm"))) void api.deleteExternalCalendar(source.id).then(reload); }}><Icon name="trash" size={17} /></button>
        </span>
      </div>)}
      {!data.externalCalendarSources.length ? <p className="empty-copy empty-copy--padded">{copy(locale, "externalCalendar", "empty")}</p> : null}
    </div>
  </section>;
}
