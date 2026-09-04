export const supportedLocales = ["de", "en"] as const;
export type AppLocale = (typeof supportedLocales)[number];

export const defaultLocale: AppLocale = "de";

export const localeMetadata: Record<
  AppLocale,
  { label: string; intlLocale: string }
> = {
  de: { label: "Deutsch", intlLocale: "de-DE" },
  en: { label: "English", intlLocale: "en-GB" }
};

const de = {
  "app.name": "Betreuungskalender",
  "app.tagline": "Betreuung übersichtlich festhalten.",
  "app.storageNotice":
    "Fachliche Daten werden im lokalen SQLite-Dienst gespeichert.",
  "nav.main": "Hauptnavigation",
  "nav.mobile": "Mobile Navigation",
  "nav.dashboard": "Übersicht",
  "nav.calendar": "Kalender",
  "nav.entries": "Einträge",
  "nav.contact": "Umgang",
  "nav.holidays": "Ferien",
  "nav.unavailable": "Nicht\u00adverfüg\u00adbarkeit",
  "nav.analytics": "Auswertung",
  "nav.report": "Bericht",
  "nav.backup": "Backup",
  "nav.audit": "Protokoll",
  "nav.rules": "Hilfe",
  "nav.settings": "Einstellungen",
  "nav.more": "Mehr",
  "nav.moreAreas": "Weitere Bereiche",
  "nav.openMore": "Weitere Bereiche öffnen",
  "nav.closeMenu": "Menü schließen",
  "nav.collapseSidebar": "Navigation einklappen",
  "nav.expandSidebar": "Navigation ausklappen",
  "legal.links": "Rechtliche Informationen",
  "legal.notice": "Impressum",
  "legal.privacy": "Datenschutz",
  "action.newEntry": "Eintrag erfassen",
  "action.entryShort": "Eintrag",
  "action.reloadApp": "App neu laden",
  "action.retryConnection": "Erneut verbinden",
  "action.close": "Schließen",
  "status.readOnly": "Nur-Lese-Modus.",
  "status.serverUnavailable":
    "Die Serververbindung ist nicht verfügbar. Änderungen können derzeit nicht gespeichert werden.",
  "status.offlineExistingData":
    "Vorhandene Daten können angesehen und exportiert werden.",
  "status.loading": "Daten werden aus SQLite geladen …",
  "status.loadingPage": "Bereich wird geladen …",
  "status.pageLoadFailed": "Bereich konnte nicht geladen werden",
  "status.pageLoadFailedDescription":
    "Prüfe die Verbindung und versuche es erneut.",
  "status.saving": "Änderungen werden gespeichert …",
  "auth.signedInAs": "Angemeldet als",
  "auth.required": "Anmeldung erforderlich",
  "auth.loginRequired": "Nicht angemeldet",
  "auth.login": "Anmelden",
  "auth.logout": "Abmelden",
  "auth.loggingOut": "Abmeldung …",
  "auth.userMenu": "Nutzermenü öffnen",
  "settings.context": "Konfiguration",
  "settings.title": "Einstellungen",
  "settings.language.title": "Sprache und Darstellung",
  "settings.appearance.label": "Darstellung",
  "settings.appearance.system": "System",
  "settings.appearance.light": "Hell",
  "settings.appearance.dark": "Dunkel",
  "settings.language.description":
    "Die Sprache ist eine lokale UI-Präferenz und verändert keine fachlichen Daten.",
  "settings.language.label": "Anzeigesprache",
  "settings.language.fallback":
    "Die gewählte Sprache gilt für alle Oberflächen. Deutsch bleibt bei technischen Fehlern die Rückfallebene.",
  "report.context": "Neutraler Bericht",
  "report.pageTitle": "Bericht & Druckansicht",
  "report.includeHistory": "Änderungshistorie aufnehmen",
  "report.print": "Drucken",
  "report.download": "PDF herunterladen",
  "report.creating": "PDF wird erstellt …",
  "report.refresh": "Bericht aktualisieren",
  "report.loading": "Berichtsdaten werden aktualisiert …",
  "report.stale": "Der angezeigte Bericht konnte nicht aktualisiert werden und kann veraltet sein.",
  "report.emptyTitle": "Noch keine Berichtsdaten",
  "report.emptyDescription": "Sobald Einträge gespeichert sind, enthält der Bericht Zeiten, Auswertungen und Nachweise für den gewählten Zeitraum.",
  "report.documentTitle": "Bericht zu dokumentierten Betreuungszeiten"
} as const;

export type TranslationKey = keyof typeof de;
type TranslationResource = Record<TranslationKey, string>;

const en = {
  "app.name": "Care Calendar",
  "app.tagline": "Track care clearly.",
  "app.storageNotice": "Domain data is stored by the local SQLite service.",
  "nav.main": "Main navigation",
  "nav.mobile": "Mobile navigation",
  "nav.dashboard": "Overview",
  "nav.calendar": "Calendar",
  "nav.entries": "Entries",
  "nav.contact": "Contact",
  "nav.holidays": "Holidays",
  "nav.unavailable": "Unavailability",
  "nav.analytics": "Analytics",
  "nav.report": "Report",
  "nav.backup": "Backup",
  "nav.audit": "Audit log",
  "nav.rules": "Help",
  "nav.settings": "Settings",
  "nav.more": "More",
  "nav.moreAreas": "More areas",
  "nav.openMore": "Open more areas",
  "nav.closeMenu": "Close menu",
  "nav.collapseSidebar": "Collapse navigation",
  "nav.expandSidebar": "Expand navigation",
  "legal.links": "Legal information",
  "legal.notice": "Legal notice",
  "legal.privacy": "Privacy",
  "action.newEntry": "Create entry",
  "action.entryShort": "Entry",
  "action.reloadApp": "Reload app",
  "action.retryConnection": "Reconnect",
  "action.close": "Close",
  "status.readOnly": "Read-only mode.",
  "status.serverUnavailable":
    "The server connection is unavailable. Changes cannot currently be saved.",
  "status.offlineExistingData": "Existing data can be viewed and exported.",
  "status.loading": "Loading data from SQLite …",
  "status.loadingPage": "Loading section …",
  "status.pageLoadFailed": "The section could not be loaded",
  "status.pageLoadFailedDescription": "Check the connection and try again.",
  "status.saving": "Saving changes …",
  "auth.signedInAs": "Signed in as",
  "auth.required": "Sign-in required",
  "auth.loginRequired": "Not signed in",
  "auth.login": "Sign in",
  "auth.logout": "Sign out",
  "auth.loggingOut": "Signing out …",
  "auth.userMenu": "Open user menu",
  "settings.context": "Configuration",
  "settings.title": "Settings",
  "settings.language.title": "Language and appearance",
  "settings.appearance.label": "Appearance",
  "settings.appearance.system": "System",
  "settings.appearance.light": "Light",
  "settings.appearance.dark": "Dark",
  "settings.language.description":
    "Language is a local UI preference and does not change domain data.",
  "settings.language.label": "Display language",
  "settings.language.fallback":
    "The selected language applies throughout the interface. German remains the fallback if a translation cannot be loaded.",
  "report.context": "Neutral report",
  "report.pageTitle": "Report & print view",
  "report.includeHistory": "Include change history",
  "report.print": "Print",
  "report.download": "Download PDF",
  "report.creating": "Creating PDF …",
  "report.refresh": "Refresh report",
  "report.loading": "Refreshing report data …",
  "report.stale": "The displayed report could not be refreshed and may be out of date.",
  "report.emptyTitle": "No report data yet",
  "report.emptyDescription": "After entries are saved, the report contains times, analytics, and documentation for the selected period.",
  "report.documentTitle": "Report on documented care periods"
} satisfies TranslationResource;

export const translationResources: Record<AppLocale, TranslationResource> = {
  de,
  en
};

export function getMissingTranslationKeys(locale: AppLocale): TranslationKey[] {
  return (Object.keys(de) as TranslationKey[]).filter(
    (key) => !translationResources[locale][key]
  );
}

export function translate(locale: AppLocale, key: TranslationKey): string {
  const value = translationResources[locale][key];
  if (value) return value;

  if (import.meta.env?.DEV && locale !== defaultLocale) {
    console.warn(`[i18n] Missing ${locale} translation for "${key}".`);
  }
  return de[key];
}
