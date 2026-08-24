import { Icon } from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";
import { copy, copyList } from "../i18n/catalog";

export function DocumentationRulesPage() {
  const { locale } = useI18n();
  const rules = copyList(locale, "documentation", "rules").map((rule) => {
    const [title, text] = rule.split("|", 2);
    return { title, text };
  });
  const topics = locale === "en"
    ? [
        {
          title: "Plan and record care",
          description: "Keep plans, actual care, cancellations, and unavailability distinguishable.",
          rules: rules.slice(0, 6)
        },
        {
          title: "Record costs and evidence",
          description: "Use concrete amounts, purposes, and references instead of general assessments.",
          rules: rules.slice(6, 8)
        },
        {
          title: "Review and safeguard data",
          description: "Close reviewed months and regularly verify that backups can be restored.",
          rules: rules.slice(8)
        }
      ]
    : [
        {
          title: "Betreuung planen und dokumentieren",
          description: "Planung, tatsächliche Betreuung, Ausfälle und Nichtverfügbarkeit bleiben klar unterscheidbar.",
          rules: rules.slice(0, 6)
        },
        {
          title: "Kosten und Nachweise erfassen",
          description: "Konkrete Beträge, Zwecke und Referenzen statt pauschaler Bewertungen verwenden.",
          rules: rules.slice(6, 8)
        },
        {
          title: "Daten prüfen und sichern",
          description: "Geprüfte Monate abschließen und die Wiederherstellung von Backups regelmäßig testen.",
          rules: rules.slice(8)
        }
      ];
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

      <div className="documentation-topics">
        {topics.map((topic, index) => (
          <details className="panel documentation-topic" open={index === 0} key={topic.title}>
            <summary>
              <span>
                <strong>{topic.title}</strong>
                <small>{topic.description}</small>
              </span>
              <Icon name="chevronRight" size={18} />
            </summary>
            <div className="documentation-topic__content">
              {topic.rules.map((rule) => (
                <article key={rule.title}>
                  <h2>{rule.title}</h2>
                  <p>{rule.text}</p>
                </article>
              ))}
            </div>
          </details>
        ))}
      </div>

      <section className="notice notice--warning">
        <Icon name="info" />
        <p>{copy(locale, "documentation", "notice")}</p>
      </section>

    </div>
  );
}
