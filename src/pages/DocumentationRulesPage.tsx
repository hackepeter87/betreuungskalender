import { Icon } from "../components/Icon";
import { FieldHelpButton } from "../components/FieldHelp";
import { useI18n } from "../i18n/I18nProvider";
import { copy, copyList } from "../i18n/catalog";
import {
  allFieldHelp,
  requirementLevelLabels,
  type FieldHelpId
} from "../config/fieldHelp";

const helpGroups: Array<{
  prefix: string;
  title: string;
  description: string;
}> = [
  { prefix: "child.", title: "Kinder", description: "Stammdaten und Kalenderdarstellung" },
  { prefix: "careEntry.", title: "Betreuungseinträge", description: "Tatsächliche und geplante Betreuung" },
  { prefix: "trip.", title: "Fahrten", description: "Betreuungsbezogene Wege und Erstattungen" },
  { prefix: "cost.", title: "Kosten", description: "Konkrete Einzelposten" },
  { prefix: "holiday.", title: "Ferien", description: "Ferienblöcke, Zuordnung und tatsächliche Betreuung" },
  { prefix: "contactPattern.", title: "Soll-Ist-Umgangsregel", description: "14-Tage-Rhythmus und Statuspflege" },
  { prefix: "unavailable.", title: "Nichtverfügbarkeiten", description: "Dienstliche und sonstige Abwesenheiten" },
  { prefix: "monthClosure.", title: "Monatsabschluss", description: "Prüfung und festgehaltener Datenstand" },
  { prefix: "analytics.", title: "Auswertungen", description: "Zeiträume, Quoten und Kennzahlen" },
  { prefix: "export.", title: "Export und Bericht", description: "Backup, CSV, PDF und Datenstand" },
  { prefix: "settings.", title: "Einstellungen und Betrieb", description: "Standardwerte, Backup und Verbindungsstatus" },
  { prefix: "entries.", title: "Listen", description: "Suchen und Filtern vorhandener Einträge" },
  { prefix: "audit.", title: "Änderungsprotokoll", description: "Änderungen gezielt auffinden" }
];

export function DocumentationRulesPage() {
  const { locale } = useI18n();
  const rules = copyList(locale, "documentation", "rules").map((rule) => {
    const [title, text] = rule.split("|", 2);
    return { title, text };
  });
  return (
    <div className="page documentation-page">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "documentation", "context")}</p>
          <h1>{copy(locale, "documentation", "title")}</h1>
        </div>
      </div>

      <section className="rules-intro">
        <Icon name="book" size={28} />
        <div>
          <h2>{copy(locale, "documentation", "introTitle")}</h2>
          <p>{copy(locale, "documentation", "intro")}</p>
        </div>
      </section>

      <div className="rules-grid">
        {rules.map((rule, index) => (
          <article className="panel rule-card" key={rule.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h2>{rule.title}</h2>
              <p>{rule.text}</p>
            </div>
          </article>
        ))}
      </div>

      <section className="notice notice--warning">
        <Icon name="info" />
        <p>{copy(locale, "documentation", "notice")}</p>
      </section>

      <section className="field-help-catalog">
        <header className="field-help-catalog__header">
          <div>
            <p className="page-header__context">{copy(locale, "documentation", "helpContext")}</p>
            <h2>{copy(locale, "documentation", "helpTitle")}</h2>
            <p>{copy(locale, "documentation", "helpDescription")}</p>
          </div>
          <div className="requirement-legend" aria-label={copy(locale, "documentation", "requirements")}>
            <span className="requirement-badge requirement-badge--required">{copy(locale, "documentation", "required")}</span>
            <span className="requirement-badge requirement-badge--recommended">{copy(locale, "documentation", "recommended")}</span>
            <span className="requirement-badge requirement-badge--optional">{copy(locale, "documentation", "optional")}</span>
          </div>
        </header>

        <div className="field-help-groups">
          {helpGroups.map((group) => {
            const items = allFieldHelp.filter((item) =>
              item.fieldId.startsWith(group.prefix)
            );
            return (
              <details className="panel field-help-group" key={group.prefix}>
                <summary>
                  <span>
                    <strong>{group.title}</strong>
                    <small>{group.description}</small>
                  </span>
                  <span>{items.length} {items.length === 1 ? "Hilfe" : "Hilfen"}</span>
                </summary>
                <div className="field-help-list">
                  {items.map((item) => (
                    <article className="field-help-list__item" key={item.fieldId}>
                      <div>
                        <span
                          className={`requirement-badge requirement-badge--${item.requirementLevel}`}
                        >
                          {requirementLevelLabels[item.requirementLevel]}
                        </span>
                        <strong>{item.label}</strong>
                        <p>{item.shortHelp}</p>
                      </div>
                      <FieldHelpButton
                        fieldId={item.fieldId as FieldHelpId}
                        showRequirement={false}
                      />
                    </article>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
