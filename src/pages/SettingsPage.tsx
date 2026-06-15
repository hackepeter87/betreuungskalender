import { useState, type FormEvent } from "react";
import { CHILD_COLORS } from "../data/defaults";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Modal } from "../components/Modal";
import { useAppStore } from "../store/AppStore";
import type { CareLocation, Child, HandoverParty } from "../types";

function ChildForm({ child, onDone }: { child?: Child; onDone: () => void }) {
  const { saveChild, canWrite, isSaving } = useAppStore();
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
        <input data-testid="child-name" autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Vorname oder Kürzel" />
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
          <span>Farbe im Kalender</span>
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
          <button className="button button--secondary" type="button" onClick={onDone}>Abbrechen</button>
          <button className="button button--primary" data-testid="child-submit" type="submit" disabled={!canWrite || isSaving}>{child ? "Speichern" : "Kind anlegen"}</button>
        </div>
      </footer>
    </form>
  );
}

export function SettingsPage() {
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
      ? `${child.name} ist in ${affected} Einträgen enthalten. Beim Löschen werden diese Zuordnungen entfernt. Fortfahren?`
      : `${child.name} wirklich löschen?`;
    if (window.confirm(message)) await removeChild(child.id);
  };

  const loadExamples = async () => {
    if (data.children.length || data.entries.some((entry) => !entry.deletedAt)) {
      if (!window.confirm("Beispieldaten ersetzen den aktuellen Datenbestand. Fortfahren?")) return;
    }
    await loadDemo();
  };

  const clearData = async () => {
    if (window.confirm("Alle Kinder, Einträge, Monatsabschlüsse, Protokolle und Einstellungen dauerhaft aus der SQLite-Datenbank löschen? Diese Aktion ersetzt den gesamten Datenbestand.")) {
      await clearAll();
    }
  };

  return (
    <div className="page page--narrow" data-testid="page-settings">
      <div className="page-header">
        <div>
          <p className="page-header__context">Konfiguration</p>
          <h1>Einstellungen</h1>
        </div>
      </div>

      <section className="panel settings-section">
        <div className="panel__header">
          <div>
            <h2>Kinder</h2>
            <p>Namen werden im lokalen SQLite-Dienst gespeichert und können auch als Kürzel geführt werden.</p>
          </div>
          <button className="button button--primary" data-testid="settings-add-child" type="button" onClick={() => setEditingChild("new")} disabled={!canWrite || isSaving}>
            <Icon name="plus" size={17} />
            Kind anlegen
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
                <small>Geboren {String(child.birthMonth).padStart(2, "0")}/{child.birthYear}</small>
              </span>
              <span className="child-settings-row__actions">
                <button className="icon-button icon-button--bordered" type="button" onClick={() => setEditingChild(child)} aria-label={`${child.name} bearbeiten`}><Icon name="edit" size={17} /></button>
                <button className="icon-button icon-button--bordered icon-button--danger" type="button" onClick={() => void deleteChild(child)} disabled={!canWrite || isSaving} aria-label={`${child.name} löschen`}><Icon name="trash" size={17} /></button>
              </span>
            </div>
          ))}
          {data.children.length === 0 ? <p className="empty-copy empty-copy--padded">Noch kein Kind angelegt.</p> : null}
        </div>
      </section>

      <section className="panel settings-section">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>Standardwerte</h2>
            <p>Neue Einträge werden mit diesen Werten vorbelegt.</p>
          </div>
        </div>
        <div className="settings-form-grid">
          <label className="field">
            <FieldHelpLabel fieldId="settings.kilometerRate">Kilometersatz in EUR</FieldHelpLabel>
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
              <option value="commuterApartment">Pendlerwohnung</option>
              <option value="mainResidence">Hauptwohnsitz</option>
              <option value="mother">Bei der Mutter</option>
              <option value="school">Schule</option>
              <option value="ogs">OGS</option>
              <option value="other">Anderer Ort</option>
            </select>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.defaultHandoverFrom">
              Übergabe standardmäßig von
            </FieldHelpLabel>
            <select value={data.settings.defaultHandoverFrom} disabled={!canWrite || isSaving} onChange={(event) => void updateSettings({ defaultHandoverFrom: event.target.value as HandoverParty })}>
              <option value="mother">Mutter</option>
              <option value="father">Vater</option>
              <option value="school">Schule</option>
              <option value="ogs">OGS</option>
              <option value="thirdParty">Dritte</option>
            </select>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.defaultHandoverTo">
              Übergabe standardmäßig an
            </FieldHelpLabel>
            <select value={data.settings.defaultHandoverTo} disabled={!canWrite || isSaving} onChange={(event) => void updateSettings({ defaultHandoverTo: event.target.value as HandoverParty })}>
              <option value="mother">Mutter</option>
              <option value="father">Vater</option>
              <option value="school">Schule</option>
              <option value="ogs">OGS</option>
              <option value="thirdParty">Dritte</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel settings-section">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>Beispiel- und Datenbankdaten</h2>
            <p>Beispieldaten helfen beim Kennenlernen und können vollständig entfernt werden.</p>
          </div>
        </div>
        <div className="data-actions">
          <button className="button button--secondary" type="button" onClick={() => void loadExamples()} disabled={!canWrite || isSaving}>Beispieldaten laden</button>
          <button className="button button--danger-quiet" type="button" onClick={() => void clearData()} disabled={!canWrite || isSaving}><Icon name="trash" size={17} />Alle Datenbankdaten löschen</button>
        </div>
      </section>

      {editingChild ? (
        <Modal title={editingChild === "new" ? "Kind anlegen" : "Kind bearbeiten"} onClose={() => setEditingChild(null)}>
          <ChildForm child={editingChild === "new" ? undefined : editingChild} onDone={() => setEditingChild(null)} />
        </Modal>
      ) : null}
    </div>
  );
}
