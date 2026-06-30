import { useState, type FormEvent } from "react";
import { CHILD_COLORS } from "../data/defaults";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Modal } from "../components/Modal";
import { ExternalCalendarManager } from "../components/ExternalCalendarManager";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { localeMetadata, supportedLocales } from "../i18n/resources";
import { actorDisplayName } from "../lib/actors";
import { formatDateTime } from "../lib/date";
import { handoverLabel, locationLabel } from "../lib/labels";
import { useAppStore } from "../store/AppStore";
import type { CareLocation, Child, HandoverParty } from "../types";

function ChildForm({ child, onDone }: { child?: Child; onDone: () => void }) {
  const { saveChild, canWrite, isSaving } = useAppStore();
  const { locale } = useI18n();
  const [name, setName] = useState(child?.name ?? "");
  const [birthMonth, setBirthMonth] = useState(child?.birthMonth ?? 1);
  const [birthYear, setBirthYear] = useState(child?.birthYear ?? new Date().getFullYear() - 8);
  const [color, setColor] = useState(child?.color ?? CHILD_COLORS[0]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (await saveChild({ id: child?.id, name, birthMonth, birthYear, color })) {
      onDone();
    }
  };

  return (
    <form className="child-form" data-testid="child-form" onSubmit={submit}>
      <label className="field">
        <FieldHelpLabel fieldId="child.name" />
        <input data-testid="child-name" autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={copy(locale, "settings", "childNamePlaceholder")} />
      </label>
      <div className="form-grid">
        <label className="field">
          <FieldHelpLabel fieldId="child.birthMonth" />
          <select value={birthMonth} onChange={(event) => setBirthMonth(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, "0")}</option>)}
          </select>
        </label>
        <label className="field">
          <FieldHelpLabel fieldId="child.birthYear" />
          <input type="number" min="1990" max={new Date().getFullYear()} required value={birthYear} onChange={(event) => setBirthYear(Number(event.target.value))} />
        </label>
      </div>
      <fieldset className="color-field">
        <legend className="field-label-row">
          <span>{copy(locale, "settings", "calendarColor")}</span>
          <FieldHelpButton fieldId="child.color" />
        </legend>
        <div>
          {CHILD_COLORS.map((option) => (
            <label key={option} className={color === option ? "is-selected" : ""}>
              <input type="radio" name="color" value={option} checked={color === option} onChange={() => setColor(option)} />
              <span style={{ backgroundColor: option }} />
            </label>
          ))}
        </div>
      </fieldset>
      <footer className="form-actions">
        <span />
        <div className="form-actions__right">
          <button className="button button--secondary" type="button" onClick={onDone}>{copy(locale, "settings", "cancel")}</button>
          <button className="button button--primary" data-testid="child-submit" type="submit" disabled={!canWrite || isSaving}>{child ? copy(locale, "settings", "saveChild") : copy(locale, "settings", "addChild")}</button>
        </div>
      </footer>
    </form>
  );
}

export function SettingsPage() {
  const { locale, intlLocale, setLocale, t } = useI18n();
  const {
    data,
    removeChild,
    updateSettings,
    loadDemo,
    clearAll,
    canWrite,
    isSaving
  } = useAppStore();
  const [editingChild, setEditingChild] = useState<Child | "new" | null>(null);

  const deleteChild = async (child: Child) => {
    const affected = data.entries.filter((entry) => !entry.deletedAt && entry.childIds.includes(child.id)).length;
    const message = affected
      ? copy(locale, "settings", "childDeleteAffected", { name: child.name, count: affected })
      : copy(locale, "settings", "childDelete", { name: child.name });
    if (window.confirm(message)) await removeChild(child.id);
  };

  const loadExamples = async () => {
    if (data.children.length || data.entries.some((entry) => !entry.deletedAt)) {
      if (!window.confirm(copy(locale, "settings", "demoReplaceConfirm"))) return;
    }
    await loadDemo();
  };

  const clearData = async () => {
    if (window.confirm(copy(locale, "settings", "clearDataConfirm"))) {
      await clearAll();
    }
  };

  return (
    <div className="page page--narrow" data-testid="page-settings">
      <div className="page-header">
        <div>
          <p className="page-header__context">{t("settings.context")}</p>
          <h1>{t("settings.title")}</h1>
        </div>
      </div>

      <section className="panel settings-section">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>{t("settings.language.title")}</h2>
            <p>{t("settings.language.description")}</p>
          </div>
        </div>
        <div className="settings-form-grid">
          <label className="field">
            <span>{t("settings.language.label")}</span>
            <select
              data-testid="settings-language"
              value={locale}
              onChange={(event) =>
                setLocale(event.target.value as (typeof supportedLocales)[number])
              }
            >
              {supportedLocales.map((supportedLocale) => (
                <option key={supportedLocale} value={supportedLocale}>
                  {localeMetadata[supportedLocale].label}
                </option>
              ))}
            </select>
            <small>{t("settings.language.fallback")}</small>
          </label>
        </div>
      </section>

      <section className="panel settings-section">
        <div className="panel__header">
          <div>
            <h2>{copy(locale, "settings", "children")}</h2>
            <p>{copy(locale, "settings", "childrenDescription")}</p>
          </div>
          <button className="button button--primary" data-testid="settings-add-child" type="button" onClick={() => setEditingChild("new")} disabled={!canWrite || isSaving}>
            <Icon name="plus" size={17} />
            {copy(locale, "settings", "addChild")}
          </button>
        </div>
        <div className="child-settings-list">
          {data.children.map((child) => (
            <div className="child-settings-row" key={child.id}>
              <span className="child-avatar" style={{ backgroundColor: `${child.color}18`, color: child.color }}>
                {child.name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{child.name}</strong>
                <small>{copy(locale, "settings", "born", { month: String(child.birthMonth).padStart(2, "0"), year: child.birthYear })}</small>
                <small>
                  {copy(locale, "common", "updatedBy", {
                    actor: actorDisplayName(data, child.updatedBy),
                    date: formatDateTime(child.updatedAt, intlLocale)
                  })}
                </small>
              </span>
              <span className="child-settings-row__actions">
                <button className="icon-button icon-button--bordered" type="button" onClick={() => setEditingChild(child)} aria-label={copy(locale, "settings", "editChildAria", { name: child.name })}><Icon name="edit" size={17} /></button>
                <button className="icon-button icon-button--bordered icon-button--danger" type="button" onClick={() => void deleteChild(child)} disabled={!canWrite || isSaving} aria-label={copy(locale, "settings", "deleteChildAria", { name: child.name })}><Icon name="trash" size={17} /></button>
              </span>
            </div>
          ))}
          {data.children.length === 0 ? <p className="empty-copy empty-copy--padded">{copy(locale, "settings", "noChildren")}</p> : null}
        </div>
      </section>

      <section className="panel settings-section">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>{copy(locale, "settings", "defaults")}</h2>
            <p>{copy(locale, "settings", "defaultsDescription")}</p>
          </div>
        </div>
        <div className="settings-form-grid">
          <label className="field">
            <FieldHelpLabel fieldId="settings.kilometerRate">{copy(locale, "settings", "kilometerRate")}</FieldHelpLabel>
            <input
              type="number"
              min="0"
              step="0.01"
              value={data.settings.kilometerRate}
              disabled={!canWrite || isSaving}
              onChange={(event) =>
                void updateSettings({ kilometerRate: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.defaultLocation" />
            <select value={data.settings.defaultLocation} disabled={!canWrite || isSaving} onChange={(event) => void updateSettings({ defaultLocation: event.target.value as CareLocation })}>
              {(["commuterApartment", "mainResidence", "mother", "school", "ogs", "other"] as const).map((value) => <option key={value} value={value}>{locationLabel(value, locale)}</option>)}
            </select>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.defaultHandoverFrom">
              {copy(locale, "settings", "defaultHandoverFrom")}
            </FieldHelpLabel>
            <select value={data.settings.defaultHandoverFrom} disabled={!canWrite || isSaving} onChange={(event) => void updateSettings({ defaultHandoverFrom: event.target.value as HandoverParty })}>
              {(["mother", "father", "school", "ogs", "thirdParty"] as const).map((value) => <option key={value} value={value}>{handoverLabel(value, locale)}</option>)}
            </select>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.defaultHandoverTo">
              {copy(locale, "settings", "defaultHandoverTo")}
            </FieldHelpLabel>
            <select value={data.settings.defaultHandoverTo} disabled={!canWrite || isSaving} onChange={(event) => void updateSettings({ defaultHandoverTo: event.target.value as HandoverParty })}>
              {(["mother", "father", "school", "ogs", "thirdParty"] as const).map((value) => <option key={value} value={value}>{handoverLabel(value, locale)}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="panel settings-section">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>{copy(locale, "settings", "demoData")}</h2>
            <p>{copy(locale, "settings", "demoDataDescription")}</p>
          </div>
        </div>
        <div className="data-actions">
          <button className="button button--secondary" type="button" onClick={() => void loadExamples()} disabled={!canWrite || isSaving}>{copy(locale, "settings", "loadDemo")}</button>
          <button className="button button--danger-quiet" type="button" onClick={() => void clearData()} disabled={!canWrite || isSaving}><Icon name="trash" size={17} />{copy(locale, "settings", "clearData")}</button>
        </div>
      </section>

      <ExternalCalendarManager />

      {editingChild ? (
        <Modal title={editingChild === "new" ? copy(locale, "settings", "addChild") : copy(locale, "settings", "editChild")} onClose={() => setEditingChild(null)}>
          <ChildForm child={editingChild === "new" ? undefined : editingChild} onDone={() => setEditingChild(null)} />
        </Modal>
      ) : null}
    </div>
  );
}
