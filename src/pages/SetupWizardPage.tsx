import { useRef, useState, type FormEvent } from "react";
import { FieldHelpLabel } from "../components/FieldHelp";
import { Icon } from "../components/Icon";
import { CHILD_COLORS } from "../data/defaults";
import { useI18n } from "../i18n/I18nProvider";
import { catalogKey, copy } from "../i18n/catalog";
import { api } from "../lib/api";
import { useAppStore } from "../store/AppStore";
import { carePartyKinds, type ApiCarePartyKind } from "../../shared/api";

interface SetupChildDraft {
  id: number;
  name: string;
  birthMonth: number;
  birthYear: number;
  color: string;
}

function defaultBirthYear(): number {
  return new Date().getFullYear() - 8;
}

function kindLabel(locale: "de" | "en", kind: ApiCarePartyKind): string {
  return copy(locale, "settings", catalogKey("settings", `carePartyKind_${kind}`));
}

function childDraft(id: number): SetupChildDraft {
  return {
    id,
    name: "",
    birthMonth: 1,
    birthYear: defaultBirthYear(),
    color: CHILD_COLORS[id % CHILD_COLORS.length]
  };
}

export function SetupWizardPage() {
  const { locale } = useI18n();
  const { session, reload, isSaving } = useAppStore();
  const [installationLabel, setInstallationLabel] = useState("");
  const [carePartyName, setCarePartyName] = useState(kindLabel(locale, "father"));
  const [carePartyKind, setCarePartyKind] = useState<ApiCarePartyKind>("father");
  const [secondaryCarePartyName, setSecondaryCarePartyName] = useState("");
  const [secondaryCarePartyKind, setSecondaryCarePartyKind] = useState<ApiCarePartyKind>("mother");
  const [primaryCareParty, setPrimaryCareParty] = useState<"primary" | "secondary">("primary");
  const nextChildId = useRef(1);
  const [children, setChildren] = useState<SetupChildDraft[]>(() => [childDraft(0)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!carePartyName.trim()) return;
    const hasSecondaryCareParty = Boolean(secondaryCarePartyName.trim());
    if (primaryCareParty === "secondary" && !hasSecondaryCareParty) return;
    const submittedChildren = children
      .filter((child) => child.name.trim())
      .map((child) => ({
        name: child.name.trim(),
        birthMonth: child.birthMonth,
        birthYear: child.birthYear,
        color: child.color
      }));
    setBusy(true);
    setError(null);
    try {
      await api.completeFirstUseSetup({
        ownerConfirmed: true,
        ...(installationLabel.trim() ? { installationLabel: installationLabel.trim() } : {}),
        careParty: {
          name: carePartyName.trim(),
          kind: carePartyKind
        },
        ...(hasSecondaryCareParty
          ? {
              secondaryCareParty: {
                name: secondaryCarePartyName.trim(),
                kind: secondaryCarePartyKind
              }
            }
          : {}),
        primaryCareParty: hasSecondaryCareParty && primaryCareParty === "secondary" ? "secondary" : "primary",
        defaultCareParty: "primary",
        children: submittedChildren
      });
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-wizard page" data-testid="setup-wizard">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "setup", "context")}</p>
          <h1>{copy(locale, "setup", "title")}</h1>
        </div>
      </div>

      <section className="panel setup-wizard__intro">
        <span className="setup-wizard__icon">
          <Icon name="check" size={24} />
        </span>
        <div>
          <h2>{copy(locale, "setup", "introTitle")}</h2>
          <p>{copy(locale, "setup", "introDescription")}</p>
        </div>
      </section>

      <form className="setup-wizard__form" onSubmit={submit}>
        <section className="panel setup-step setup-step--owner">
          <div className="setup-step__number">1</div>
          <div className="setup-step__content">
            <h2>{copy(locale, "setup", "ownerTitle")}</h2>
            <p>{copy(locale, "setup", "ownerDescription")}</p>
            <div className="setup-owner-card">
              <Icon name="user" size={18} />
              <span>
                <small>{copy(locale, "setup", "signedInUser")}</small>
                <strong>{session.user?.displayName ?? copy(locale, "setup", "unknownUser")}</strong>
              </span>
            </div>
          </div>
        </section>

        <section className="panel setup-step">
          <div className="setup-step__number">2</div>
          <div className="setup-step__content">
            <h2>{copy(locale, "setup", "basicTitle")}</h2>
            <p>{copy(locale, "setup", "basicDescription")}</p>
            <div className="setup-basics">
              <label className="field setup-installation-field">
                <span>{copy(locale, "setup", "installationLabel")}</span>
                <input
                  data-testid="setup-installation-label"
                  value={installationLabel}
                  maxLength={120}
                  onChange={(event) => setInstallationLabel(event.target.value)}
                  placeholder={copy(locale, "setup", "installationLabelPlaceholder")}
                />
                <small>{copy(locale, "setup", "optional")}</small>
              </label>
              <div className="setup-person-grid" data-testid="setup-person-grid">
              <article className="setup-person-card" data-testid="setup-primary-person-card">
                <div className="setup-person-card__header">
                  <div>
                    <h3>{copy(locale, "setup", "ownCarePartyTitle")}</h3>
                    <p>{copy(locale, "setup", "ownCarePartyHint")}</p>
                  </div>
                  <label className="toggle setup-primary-toggle" data-testid="setup-primary-care-party-own-toggle">
                    <input
                      data-testid="setup-primary-care-party-own"
                      type="radio"
                      name="setup-primary-care-party"
                      checked={primaryCareParty === "primary"}
                      onChange={() => setPrimaryCareParty("primary")}
                    />
                    <span />
                    {copy(locale, "setup", "primaryCarePartyToggle")}
                  </label>
                </div>
                <label className="field">
                  <span>{copy(locale, "setup", "carePartyKind")}</span>
                  <select
                    data-testid="setup-care-party-kind"
                    value={carePartyKind}
                    onChange={(event) => {
                      const nextKind = event.target.value as ApiCarePartyKind;
                      if (!carePartyName.trim() || carePartyName === kindLabel(locale, carePartyKind)) {
                        setCarePartyName(kindLabel(locale, nextKind));
                      }
                      setCarePartyKind(nextKind);
                    }}
                  >
                    {carePartyKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabel(locale, kind)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{copy(locale, "setup", "carePartyName")}</span>
                  <input
                    data-testid="setup-care-party-name"
                    required
                    value={carePartyName}
                    maxLength={200}
                    onChange={(event) => setCarePartyName(event.target.value)}
                  />
                  <small>{copy(locale, "setup", "ownDefaultCarePartyDescription")}</small>
                </label>
              </article>
              <article className="setup-person-card" data-testid="setup-secondary-person-card">
                <div className="setup-person-card__header">
                  <div>
                    <h3>{copy(locale, "setup", "secondaryCarePartyName")}</h3>
                    <p>{copy(locale, "setup", "secondaryCarePartyDescription")}</p>
                  </div>
                  <label className="toggle setup-primary-toggle" data-testid="setup-primary-care-party-secondary-toggle">
                    <input
                      data-testid="setup-primary-care-party-secondary"
                      type="radio"
                      name="setup-primary-care-party"
                      checked={primaryCareParty === "secondary"}
                      onChange={() => {
                        if (!secondaryCarePartyName.trim()) {
                          setSecondaryCarePartyName(kindLabel(locale, secondaryCarePartyKind));
                        }
                        setPrimaryCareParty("secondary");
                      }}
                    />
                    <span />
                    {copy(locale, "setup", "primaryCarePartyToggle")}
                  </label>
                </div>
                <label className="field">
                  <span>{copy(locale, "setup", "secondaryCarePartyKind")}</span>
                  <select
                    data-testid="setup-secondary-care-party-kind"
                    value={secondaryCarePartyKind}
                    onChange={(event) => {
                      const nextKind = event.target.value as ApiCarePartyKind;
                      if (secondaryCarePartyName === kindLabel(locale, secondaryCarePartyKind)) {
                        setSecondaryCarePartyName(kindLabel(locale, nextKind));
                      }
                      setSecondaryCarePartyKind(nextKind);
                    }}
                  >
                    {carePartyKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabel(locale, kind)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{copy(locale, "setup", "secondaryCarePartyLabel")}</span>
                  <input
                    data-testid="setup-secondary-care-party-name"
                    value={secondaryCarePartyName}
                    maxLength={200}
                    onChange={(event) => {
                      setSecondaryCarePartyName(event.target.value);
                      if (!event.target.value.trim()) setPrimaryCareParty("primary");
                    }}
                    placeholder={kindLabel(locale, secondaryCarePartyKind)}
                  />
                  <small>{copy(locale, "setup", "optional")}</small>
                </label>
              </article>
              </div>
            </div>
          </div>
        </section>

        <section className="panel setup-step">
          <div className="setup-step__number">3</div>
          <div className="setup-step__content">
            <h2>{copy(locale, "setup", "childrenTitle")}</h2>
            <p>{copy(locale, "setup", "childrenDescription")}</p>
            <div className="setup-children-list" data-testid="setup-children-list">
              {children.map((child, index) => (
                <article className="setup-child-card" data-testid="setup-child-card" key={child.id}>
                  <header className="setup-child-card__header">
                    <h3>{copy(locale, "setup", "childCardTitle")} {index + 1}</h3>
                    <button
                      className="icon-button icon-button--danger"
                      type="button"
                      title={copy(locale, "setup", "removeChild")}
                      aria-label={`${copy(locale, "setup", "removeChild")} ${index + 1}`}
                      onClick={() => setChildren((current) => current.filter((item) => item.id !== child.id))}
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </header>
                  <div className="setup-child-grid" data-testid="setup-child-grid">
                    <label className="field">
                      <FieldHelpLabel fieldId="child.name">
                        {copy(locale, "setup", "childName")}
                      </FieldHelpLabel>
                      <input
                        data-testid="setup-child-name"
                        value={child.name}
                        maxLength={200}
                        onChange={(event) => setChildren((current) => current.map((item) => (
                          item.id === child.id ? { ...item, name: event.target.value } : item
                        )))}
                        placeholder={copy(locale, "settings", "childNamePlaceholder")}
                      />
                      <small>{copy(locale, "setup", "optional")}</small>
                    </label>
                    <label className="field">
                      <FieldHelpLabel fieldId="child.birthMonth" />
                      <select
                        value={child.birthMonth}
                        onChange={(event) => setChildren((current) => current.map((item) => (
                          item.id === child.id ? { ...item, birthMonth: Number(event.target.value) } : item
                        )))}
                      >
                        {Array.from({ length: 12 }, (_, monthIndex) => (
                          <option key={monthIndex + 1} value={monthIndex + 1}>
                            {String(monthIndex + 1).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <FieldHelpLabel fieldId="child.birthYear" />
                      <input
                        type="number"
                        min="1900"
                        max={new Date().getFullYear()}
                        value={child.birthYear}
                        onChange={(event) => setChildren((current) => current.map((item) => (
                          item.id === child.id ? { ...item, birthYear: Number(event.target.value) } : item
                        )))}
                      />
                    </label>
                  </div>
                  <fieldset className="color-field setup-color-field">
                    <legend className="field-label-row">
                      <span>{copy(locale, "settings", "calendarColor")}</span>
                    </legend>
                    <div>
                      {CHILD_COLORS.map((option) => (
                        <label key={option} className={child.color === option ? "is-selected" : ""}>
                          <input
                            type="radio"
                            name={`setup-child-color-${child.id}`}
                            value={option}
                            checked={child.color === option}
                            onChange={() => setChildren((current) => current.map((item) => (
                              item.id === child.id ? { ...item, color: option } : item
                            )))}
                          />
                          <span style={{ backgroundColor: option }} />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </article>
              ))}
            </div>
            <button
              className="button button--secondary setup-add-child"
              data-testid="setup-add-child"
              type="button"
              disabled={children.length >= 20}
              onClick={() => {
                const id = nextChildId.current;
                nextChildId.current += 1;
                setChildren((current) => [...current, childDraft(id)]);
              }}
            >
              <Icon name="plus" size={17} />
              {copy(locale, "setup", "addChild")}
            </button>
          </div>
        </section>

        <section className="panel setup-step setup-step--discovery">
          <div className="setup-step__number">4</div>
          <div className="setup-step__content">
            <h2>{copy(locale, "setup", "calendarTitle")}</h2>
            <p>{copy(locale, "setup", "calendarDescription")}</p>
            <div className="setup-discovery-grid">
              <article className="setup-discovery-card" data-testid="setup-calendar-feed-discovery">
                <Icon name="calendar" size={20} />
                <div>
                  <h3>{copy(locale, "setup", "calendarFeedTitle")}</h3>
                  <p>{copy(locale, "setup", "calendarFeedDescription")}</p>
                </div>
              </article>
              <article className="setup-discovery-card" data-testid="setup-calendar-import-discovery">
                <Icon name="upload" size={20} />
                <div>
                  <h3>{copy(locale, "setup", "calendarImportTitle")}</h3>
                  <p>{copy(locale, "setup", "calendarImportDescription")}</p>
                </div>
              </article>
              <article className="setup-discovery-card" data-testid="setup-calendar-export-discovery">
                <Icon name="download" size={20} />
                <div>
                  <h3>{copy(locale, "setup", "calendarExportTitle")}</h3>
                  <p>{copy(locale, "setup", "calendarExportDescription")}</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <footer className="panel setup-wizard__actions">
          <p>{copy(locale, "setup", "finishNote")}</p>
          <button
            className="button button--primary"
            data-testid="setup-wizard-submit"
            type="submit"
            disabled={busy || isSaving || !carePartyName.trim()}
          >
            <Icon name="check" size={17} />
            {busy ? copy(locale, "setup", "saving") : copy(locale, "setup", "finish")}
          </button>
        </footer>
      </form>
    </div>
  );
}
