import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { useAppStore } from "../store/AppStore";
import { Icon } from "./Icon";
import { FieldHelpButton, FieldHelpLabel } from "./FieldHelp";

const DEFAULT_COLOR = "#2563eb";

export function ExternalCalendarManager() {
  const { data, reload, canWrite, isSaving } = useAppStore();
  const { locale, intlLocale } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceKind, setSourceKind] = useState<"file" | "url">("file");
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [sourceType, setSourceType] = useState<"overlay" | "holiday">("overlay");
  const [feedUrl, setFeedUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  const resetForm = () => {
    setName("");
    setColor(DEFAULT_COLOR);
    setSourceType("overlay");
    setFeedUrl("");
    setFileName("");
    setReplacingId(null);
    if (inputRef.current) inputRef.current.value = "";
  };
  const readFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".ics")) throw new Error(copy(locale, "externalCalendar", "invalid"));
    return file.text();
  };
  const importFile = async (file?: File, sourceId?: string) => {
    if (!file || !name.trim()) return;
    try {
      const content = await readFile(file);
      const result = sourceId
        ? await api.replaceExternalCalendar(sourceId, { name: name.trim(), color, sourceType, content })
        : await api.importExternalCalendar({ name: name.trim(), color, sourceType, content });
      setMessage(copy(locale, "externalCalendar", "imported", { count: result.importedEvents }));
      resetForm();
      await reload();
    } catch {
      setMessage(copy(locale, "externalCalendar", "invalid"));
    }
  };
  const importFeed = async (sourceId?: string) => {
    if (!name.trim() || !feedUrl.trim()) return;
    try {
      const result = sourceId
        ? await api.replaceExternalCalendarFeed(sourceId, { name: name.trim(), color, sourceType, url: feedUrl.trim() })
        : await api.importExternalCalendarFeed({ name: name.trim(), color, sourceType, url: feedUrl.trim() });
      setMessage(copy(locale, "externalCalendar", "imported", { count: result.importedEvents }));
      resetForm();
      await reload();
    } catch {
      setMessage(copy(locale, "externalCalendar", "invalidFeed"));
    }
  };
  const refreshFeed = async (sourceId: string) => {
    try {
      const result = await api.refreshExternalCalendarFeed(sourceId);
      setMessage(copy(locale, "externalCalendar", "refreshed", { count: result.importedEvents }));
      await reload();
    } catch {
      setMessage(copy(locale, "externalCalendar", "refreshFailed"));
      await reload();
    }
  };

  return <section className="panel settings-section settings-section--external-calendar" data-testid="external-calendar-manager">
    <div className="panel__header panel__header--compact"><div><h2>{copy(locale, "externalCalendar", "title")}</h2><p>{copy(locale, "externalCalendar", "description")}</p></div></div>
    <div className="external-calendar-import-grid">
      <div className="segmented-control external-calendar-kind-control" role="group" aria-label={copy(locale, "externalCalendar", "sourceKind")}>
        <button className={sourceKind === "file" ? "is-active" : ""} type="button" onClick={() => { setSourceKind("file"); setReplacingId(null); }}>
          <Icon name="upload" size={16} />
          {copy(locale, "externalCalendar", "sourceKindFile")}
        </button>
        <button className={sourceKind === "url" ? "is-active" : ""} type="button" onClick={() => { setSourceKind("url"); setReplacingId(null); }}>
          <Icon name="calendar" size={16} />
          {copy(locale, "externalCalendar", "sourceKindUrl")}
        </button>
      </div>
      <label className="field">
        <FieldHelpLabel fieldId="externalCalendar.sourceName">
          {copy(locale, "externalCalendar", "sourceName")}
        </FieldHelpLabel>
        <input data-testid="external-calendar-name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field external-calendar-color-field">
        <FieldHelpLabel fieldId="externalCalendar.color">
          {copy(locale, "externalCalendar", "color")}
        </FieldHelpLabel>
        <input data-testid="external-calendar-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      </label>
      <label className="field">
        <FieldHelpLabel fieldId="externalCalendar.sourceType">
          {copy(locale, "externalCalendar", "sourceType")}
        </FieldHelpLabel>
        <select data-testid="external-calendar-source-type" value={sourceType} onChange={(event) => setSourceType(event.target.value as "overlay" | "holiday")}>
          <option value="overlay">{copy(locale, "externalCalendar", "sourceTypeOverlay")}</option>
          <option value="holiday">{copy(locale, "externalCalendar", "sourceTypeHoliday")}</option>
        </select>
      </label>
      {sourceKind === "file" ? (
        <div className="field external-calendar-file-field">
          <span className="field-label-row">
            <span>{copy(locale, "externalCalendar", "file")}</span>
            <FieldHelpButton fieldId="externalCalendar.file" />
          </span>
          <div className="file-picker-row">
            <button className="button button--secondary" type="button" onClick={() => inputRef.current?.click()}>
              <Icon name="upload" size={17} />
              {copy(locale, "externalCalendar", "chooseFile")}
            </button>
            <span>{fileName || copy(locale, "externalCalendar", "noFile")}</span>
          </div>
          <input
            ref={inputRef}
            className="visually-hidden-file"
            type="file"
            accept=".ics,text/calendar"
            data-testid="external-calendar-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setFileName(file?.name ?? "");
              if (replacingId) void importFile(file, replacingId).finally(() => setReplacingId(null));
            }}
          />
        </div>
      ) : (
        <label className="field external-calendar-url-field">
          <span className="field-label-row">
            <span>{copy(locale, "externalCalendar", "feedUrl")}</span>
            <FieldHelpButton fieldId="externalCalendar.feedUrl" />
          </span>
          <input data-testid="external-calendar-url" inputMode="url" placeholder="https://calendar.example.net/calendar.ics" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} />
          <small>{copy(locale, "externalCalendar", "feedUrlHint")}</small>
        </label>
      )}
      <button
        className="button button--primary"
        type="button"
        data-testid="external-calendar-import"
        disabled={!canWrite || isSaving || !name.trim() || (sourceKind === "file" ? !fileName : !feedUrl.trim())}
        onClick={() => sourceKind === "file" ? void importFile(inputRef.current?.files?.[0], replacingId ?? undefined) : void importFeed(replacingId ?? undefined)}
      >
        <Icon name={sourceKind === "file" ? "upload" : "calendar"} size={17} />
        {replacingId
          ? copy(locale, "externalCalendar", sourceKind === "file" ? "replace" : "replaceFeed")
          : copy(locale, "externalCalendar", sourceKind === "file" ? "import" : "addFeed")}
      </button>
    </div>
    {message ? <p className="inline-message" role="status" data-testid="external-calendar-message">{message}</p> : null}
    <div className="child-settings-list">
      {data.externalCalendarSources.map((source) => <div className="child-settings-row child-settings-row--external-source" key={source.id} data-testid={`external-calendar-source-${source.id}`}>
        <span className="child-avatar" style={{ backgroundColor: `${source.color}18`, color: source.color }}><Icon name="calendar" size={18} /></span>
        <span>
          <strong>{source.name}</strong>
          <small>
            {source.sourceKind === "url" ? copy(locale, "externalCalendar", "sourceKindUrl") : copy(locale, "externalCalendar", "sourceKindFile")}
            {" · "}
            {source.sourceType === "holiday" ? copy(locale, "externalCalendar", "sourceTypeHoliday") : copy(locale, "externalCalendar", "sourceTypeOverlay")}
          </small>
          {source.feedUrlRedacted ? <small>{source.feedUrlRedacted}</small> : null}
          <small>{new Date(source.lastImportedAt).toLocaleString(intlLocale)}</small>
          {source.lastRefreshError ? <small className="text-danger">{copy(locale, "externalCalendar", "lastRefreshFailed")}</small> : null}
        </span>
        <span className="child-settings-row__actions">
          <label className="toggle" data-testid={`external-calendar-visible-control-${source.id}`}><input data-testid={`external-calendar-visible-${source.id}`} type="checkbox" checked={source.visible} disabled={!canWrite || isSaving} onChange={(event) => void api.updateExternalCalendar(source.id, { visible: event.target.checked }).then(reload)} /><span />{copy(locale, "externalCalendar", "visible")}</label>
          <label className="field field--compact">
            <span>{copy(locale, "externalCalendar", "sourceType")}</span>
            <select
              data-testid={`external-calendar-source-type-${source.id}`}
              value={source.sourceType}
              disabled={!canWrite || isSaving}
              onChange={(event) => void api.updateExternalCalendar(source.id, { sourceType: event.target.value as "overlay" | "holiday" }).then(reload)}
            >
              <option value="overlay">{copy(locale, "externalCalendar", "sourceTypeOverlay")}</option>
              <option value="holiday">{copy(locale, "externalCalendar", "sourceTypeHoliday")}</option>
            </select>
          </label>
          {source.sourceKind === "url" ? (
            <>
              <button className="button button--secondary" type="button" data-testid={`external-calendar-refresh-${source.id}`} disabled={!canWrite || isSaving} onClick={() => void refreshFeed(source.id)}>{copy(locale, "externalCalendar", "refresh")}</button>
              <button className="button button--secondary" type="button" data-testid={`external-calendar-replace-${source.id}`} disabled={!canWrite || isSaving} onClick={() => { setSourceKind("url"); setName(source.name); setColor(source.color); setSourceType(source.sourceType); setFeedUrl(""); setFileName(""); setReplacingId(source.id); }}>{copy(locale, "externalCalendar", "replaceFeed")}</button>
            </>
          ) : (
            <button className="button button--secondary" type="button" data-testid={`external-calendar-replace-${source.id}`} disabled={!canWrite || isSaving} onClick={() => { setSourceKind("file"); setName(source.name); setColor(source.color); setSourceType(source.sourceType); setFeedUrl(""); setReplacingId(source.id); inputRef.current?.click(); }}>{copy(locale, "externalCalendar", "replace")}</button>
          )}
          <button className="icon-button icon-button--danger" data-testid={`external-calendar-delete-${source.id}`} aria-label={copy(locale, "externalCalendar", "delete")} type="button" disabled={!canWrite || isSaving} onClick={() => { if (window.confirm(copy(locale, "externalCalendar", "deleteConfirm"))) void api.deleteExternalCalendar(source.id).then(reload); }}><Icon name="trash" size={17} /></button>
        </span>
      </div>)}
      {!data.externalCalendarSources.length ? <p className="empty-copy empty-copy--padded">{copy(locale, "externalCalendar", "empty")}</p> : null}
    </div>
  </section>;
}
