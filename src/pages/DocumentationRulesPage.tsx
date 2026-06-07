import { Icon } from "../components/Icon";
import { FieldHelpButton } from "../components/FieldHelp";
import {
  allFieldHelp,
  requirementLevelLabels,
  type FieldHelpId
} from "../config/fieldHelp";

const rules = [
  {
    title: "Tatsachen statt Bewertungen",
    text: "Dokumentiere konkrete Zeitpunkte, Abläufe und Beträge. Die Anwendung trifft keine rechtliche Bewertung und dient nicht der Beurteilung anderer Personen."
  },
  {
    title: "Planung und tatsächliche Betreuung trennen",
    text: "Geplante Soll-Termine bleiben als Planung erkennbar. Nach dem Termin wird der Status auf durchgeführt oder mit sachlichem Grund auf ausgefallen gesetzt."
  },
  {
    title: "Übernachtung",
    text: "Eine Übernachtung wird nur markiert, wenn das Kind tatsächlich über Nacht betreut wurde. Abendbetreuung und kurze Kontakte bleiben davon getrennt."
  },
  {
    title: "Umfang nicht künstlich aufwerten",
    text: "Stundenweise Betreuung, Besuch, Freizeitkontakt, Abholung und Begleitung werden nicht ohne Weiteres als voller Betreuungstag dargestellt."
  },
  {
    title: "Ausgefallene Termine erhalten",
    text: "Ein ausgefallener Soll-Termin wird nicht gelöscht, sondern als ausgefallen mit einem konkreten, neutral formulierten Grund dokumentiert."
  },
  {
    title: "Dienstliche Abwesenheit getrennt erfassen",
    text: "Nichtverfügbarkeiten werden als eigener Zeitraum dokumentiert. Sie werden nicht automatisch als ausgefallener oder nicht wahrgenommener Umgang bewertet."
  },
  {
    title: "Kosten und Fahrten konkret erfassen",
    text: "Erfasse tatsächliche Einzelbeträge und realistische Kilometer mit nachvollziehbarem Anlass. Rechnerische Fahrtkosten sind kein Zahlungsnachweis."
  },
  {
    title: "Belege eindeutig benennen",
    text: "Belege bleiben extern gespeichert und werden mit einem eindeutigen Dateinamen oder einer festen Referenz verknüpft."
  },
  {
    title: "Monatsabschluss und Backups",
    text: "Prüfe offene Termine vor dem Monatsabschluss. Erstelle regelmäßig JSON-Backups und teste gelegentlich, ob eine Sicherung wieder eingelesen werden kann."
  }
];

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
  return (
    <div className="page documentation-page">
      <div className="page-header">
        <div>
          <p className="page-header__context">Einheitliche Erfassung</p>
          <h1>Dokumentationsregeln</h1>
        </div>
      </div>

      <section className="rules-intro">
        <Icon name="book" size={28} />
        <div>
          <h2>Sachlich, zeitnah und nachvollziehbar dokumentieren</h2>
          <p>Die Regeln und Feldhilfen unterstützen eine konsistente Datenerfassung. Sie enthalten keine Rechtsberatung und keine Bewertung anderer Personen.</p>
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
        <p>Die Anwendung dokumentiert Nutzereingaben und erzeugt technische Auswertungen. Sie beurteilt weder das Verhalten beteiligter Personen noch die rechtliche Bedeutung einzelner Angaben.</p>
      </section>

      <section className="field-help-catalog">
        <header className="field-help-catalog__header">
          <div>
            <p className="page-header__context">Zentrale Feldhilfe</p>
            <h2>Hilfetexte für alle Eingabebereiche</h2>
            <p>
              Öffne die Hilfe über das Info-Symbol. Dieselben zentral gepflegten
              Texte werden direkt in den Formularen verwendet.
            </p>
          </div>
          <div className="requirement-legend" aria-label="Anforderungsstufen">
            <span className="requirement-badge requirement-badge--required">Pflichtfeld</span>
            <span className="requirement-badge requirement-badge--recommended">Empfohlen</span>
            <span className="requirement-badge requirement-badge--optional">Optional</span>
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
