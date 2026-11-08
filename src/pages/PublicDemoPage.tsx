import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiPublicDemoEntry,
  ApiPublicDemoProjection
} from "../../shared/api";
import { Icon } from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";
import type { TranslationKey } from "../i18n/resources";
import { loadPublicDemoProjection } from "../lib/api";
import { demoCountdown, formatDemoCountdown } from "../lib/demoLifecycle";

const MAX_VISIBLE_ENTRIES = 60;

function interpolate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function statusKey(status: ApiPublicDemoEntry["status"]): TranslationKey {
  return `demo.status.${status}` as TranslationKey;
}

export function PublicDemoPage() {
  const { intlLocale, locale, setLocale, t } = useI18n();
  const [projection, setProjection] = useState<ApiPublicDemoProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const receivedAt = useRef(0);
  const mounted = useRef(true);
  const hasLoaded = useRef(false);

  const load = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);
    try {
      const next = await loadPublicDemoProjection();
      if (!mounted.current) return;
      receivedAt.current = performance.now();
      setProjection(next);
    } catch {
      if (mounted.current) setProjection(null);
    } finally {
      if (mounted.current) {
        hasLoaded.current = true;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const clock = window.setInterval(() => setTick((value) => value + 1), 1_000);
    const refresh = window.setInterval(() => void load(), 30_000);
    return () => {
      mounted.current = false;
      window.clearInterval(clock);
      window.clearInterval(refresh);
    };
  }, [load]);

  const countdown = projection
    ? demoCountdown(
        projection.lifecycle.nextResetAt,
        projection.generatedAt,
        performance.now() - receivedAt.current
      )
    : null;
  const available = Boolean(projection && countdown && !countdown.expired);
  const entries = useMemo(
    () => projection?.entries.slice(0, MAX_VISIBLE_ENTRIES) ?? [],
    [projection]
  );
  const children = useMemo(
    () => new Map(projection?.children.map((child) => [child.id, child]) ?? []),
    [projection]
  );
  const parties = useMemo(
    () => new Map(projection?.careParties.map((party) => [party.id, party.name]) ?? []),
    [projection]
  );
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, {
      dateStyle: "medium",
      timeStyle: "short"
    }),
    [intlLocale]
  );
  const resetTime = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short"
    }),
    [intlLocale]
  );

  return (
    <div className="public-demo">
      <a className="sr-only" href="#demo-content">{t("demo.skipToContent")}</a>
      <header className="page-header public-demo__topbar">
        <a className="brand" href="/demo">
          <span className="brand__mark"><img className="brand__logo" src="/icons/app-logo-nav.svg" alt="" /></span>
          <span><strong>{t("app.name")}</strong><small>{t("demo.context")}</small></span>
        </a>
        <div className="page-header__actions">
          <div className="segmented-control" aria-label={locale === "de" ? "Sprache" : "Language"} role="group">
            <button className={locale === "de" ? "is-active" : ""} type="button" aria-pressed={locale === "de"} onClick={() => setLocale("de")}>DE</button>
            <button className={locale === "en" ? "is-active" : ""} type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
          </div>
          <a className="button button--secondary" href="/auth/login" aria-label={t("demo.login")}>
            <Icon name="lock" size={16} />
            <span>{t("auth.login")}</span>
          </a>
        </div>
      </header>

      <main className="page public-demo__main" id="demo-content">
        <section className="page-header" aria-labelledby="demo-title">
          <div><p className="page-header__context">{t("demo.context")}</p><h1 id="demo-title">{t("demo.title")}</h1><p className="section-copy">{t("demo.intro")}</p></div>
        </section>

        <section className="form-grid form-grid--two" aria-label={t("demo.sharedTitle")}>
          <div className="privacy-card">
            <Icon name="users" size={20} />
            <div><h2>{t("demo.sharedTitle")}</h2><p>{t("demo.sharedDescription")}</p></div>
          </div>
          <div className="privacy-card">
            <Icon name="repeat" size={20} />
            <div><h2>{t("demo.resetTitle")}</h2><p>{t("demo.resetDescription")}</p></div>
          </div>
        </section>

        {available && projection && countdown ? (
          <>
            <section
              className={`notice public-demo__reset-status ${countdown.urgent ? "notice--warning" : "notice--success"}`}
              aria-labelledby="demo-reset-heading"
            >
              <div>
                <Icon name={countdown.urgent ? "alert" : "clock"} size={21} />
                <div>
                  <p id="demo-reset-heading">{countdown.urgent ? t("demo.finalMinutesTitle") : t("demo.nextReset")}</p>
                  <strong>{resetTime.format(new Date(projection.lifecycle.nextResetAt))}</strong>
                  {countdown.urgent ? <small role="status">{t("demo.finalMinutesDescription")}</small> : null}
                </div>
              </div>
              <span className="public-demo__countdown" aria-label={interpolate(t("demo.countdown"), { time: formatDemoCountdown(countdown.remainingSeconds) })}>
                {formatDemoCountdown(countdown.remainingSeconds)}
              </span>
            </section>

            <section className="public-demo__entries panel" aria-labelledby="demo-entries-heading">
              <header className="panel__header">
                <div><h2 id="demo-entries-heading">{t("demo.entriesTitle")}</h2><p>{t("demo.entriesDescription")}</p></div>
              </header>
              {entries.length ? (
                <div className="panel-form line-item-list" role="list">
                  {entries.map((entry) => {
                    const childNames = entry.childIds
                      .map((id) => children.get(id)?.name)
                      .filter((name): name is string => Boolean(name));
                    const childLabel = childNames.length
                      ? new Intl.ListFormat(intlLocale, { style: "long", type: "conjunction" }).format(childNames)
                      : t("demo.entryFallback");
                    const party = entry.responsiblePartyId
                      ? parties.get(entry.responsiblePartyId) ?? t("demo.partyFallback")
                      : t("demo.partyFallback");
                    return (
                      <div className="line-item" key={entry.id} role="listitem">
                        <div className="line-item__heading">
                          <span className="table-child"><span className="child-dot" aria-hidden="true" style={{ backgroundColor: children.get(entry.childIds[0] ?? "")?.color }} /><strong>{interpolate(t("demo.entryTitle"), { children: childLabel, party })}</strong></span>
                          <span className={`status-label status-label--${entry.status}`}>{t(statusKey(entry.status))}</span>
                        </div>
                        <p className="section-copy">{dateTime.format(new Date(entry.startDateTime))} – {dateTime.format(new Date(entry.endDateTime))}</p>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="empty-copy empty-copy--padded">{t("demo.noEntries")}</p>}
              {projection.entries.length > entries.length ? (
                <p className="public-demo__more">{interpolate(t("demo.moreEntries"), { count: projection.entries.length - entries.length })}</p>
              ) : null}
            </section>
          </>
        ) : (
          <section className="panel empty-state public-demo__unavailable" aria-live="polite">
            <span><Icon name={loading ? "clock" : "alert"} size={26} /></span>
            <h2>{loading ? t("demo.loading") : t("demo.unavailableTitle")}</h2>
            {!loading ? <><p>{t("demo.unavailableDescription")}</p><button className="button button--secondary" type="button" onClick={() => void load()}>{t("demo.retry")}</button></> : null}
          </section>
        )}
      </main>

      <footer className="page-header public-demo__footer">
        <span>{t("app.name")}</span>
        <nav className="app-legal-links" aria-label={t("legal.links")}><a href="/impressum">{t("legal.notice")}</a><a href="/datenschutz">{t("legal.privacy")}</a></nav>
      </footer>
    </div>
  );
}
