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
  "app.tagline": "Fakten lokal dokumentieren.",
  "app.storageNotice":
    "Fachliche Daten werden im lokalen SQLite-Dienst gespeichert.",
  "nav.main": "Hauptnavigation",
  "nav.mobile": "Mobile Navigation",
  "nav.dashboard": "Übersicht",
  "nav.calendar": "Kalender",
  "nav.entries": "Einträge",
  "nav.contact": "Umgang",
  "nav.holidays": "Ferien",
  "nav.unavailable": "Nichtverfügbarkeit",
  "nav.analytics": "Auswertung",
  "nav.report": "Bericht",
  "nav.backup": "Backup",
  "nav.audit": "Protokoll",
  "nav.rules": "Regeln",
  "nav.settings": "Einstellungen",
  "nav.more": "Mehr",
  "nav.moreAreas": "Weitere Bereiche",
  "nav.openMore": "Weitere Bereiche öffnen",
  "nav.closeMenu": "Menü schließen",
  "action.newEntry": "Eintrag erfassen",
  "action.entryShort": "Eintrag",
  "action.retryConnection": "Erneut verbinden",
  "action.close": "Schließen",
  "status.readOnly": "Nur-Lese-Modus.",
  "status.serverUnavailable":
    "Die Serververbindung ist nicht verfügbar. Änderungen können derzeit nicht gespeichert werden.",
  "status.offlineExistingData":
    "Vorhandene Daten können angesehen und exportiert werden.",
  "status.loading": "Daten werden aus SQLite geladen …",
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
  "settings.language.title": "Sprache und Region",
  "settings.language.description":
    "Die Sprache ist eine lokale UI-Präferenz und verändert keine fachlichen Daten.",
  "settings.language.label": "Anzeigesprache",
  "settings.language.fallback":
    "Noch nicht übersetzte Bereiche werden weiterhin auf Deutsch angezeigt.",
  "report.context": "Neutraler Bericht",
  "report.pageTitle": "Bericht & Druckansicht",
  "report.includeHistory": "Änderungshistorie aufnehmen",
  "report.print": "Drucken",
  "report.download": "PDF herunterladen",
  "report.creating": "PDF wird erstellt …",
  "report.documentTitle": "Bericht zu dokumentierten Betreuungszeiten"
} as const;

export type TranslationKey = keyof typeof de;
type TranslationResource = Partial<Record<TranslationKey, string>>;

const en: TranslationResource = {
  "app.name": "Care Calendar",
  "app.tagline": "Document facts locally.",
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
  "nav.rules": "Rules",
  "nav.settings": "Settings",
  "nav.more": "More",
  "nav.moreAreas": "More areas",
  "nav.openMore": "Open more areas",
  "nav.closeMenu": "Close menu",
  "action.newEntry": "Create entry",
  "action.entryShort": "Entry",
  "action.retryConnection": "Reconnect",
  "action.close": "Close",
  "status.readOnly": "Read-only mode.",
  "status.serverUnavailable":
    "The server connection is unavailable. Changes cannot currently be saved.",
  "status.offlineExistingData": "Existing data can be viewed and exported.",
  "status.loading": "Loading data from SQLite …",
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
  "settings.language.title": "Language and region",
  "settings.language.description":
    "Language is a local UI preference and does not change domain data.",
  "settings.language.label": "Display language",
  "settings.language.fallback":
    "Areas not translated yet continue to be displayed in German.",
  "report.context": "Neutral report",
  "report.pageTitle": "Report & print view",
  "report.includeHistory": "Include change history",
  "report.print": "Print",
  "report.download": "Download PDF",
  "report.creating": "Creating PDF …",
  "report.documentTitle": "Report on documented care periods"
};

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
