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
  "demo.skipToContent": "Zum Inhalt springen",
  "demo.context": "Öffentliche Demo",
  "demo.title": "Fiktive Betreuungstermine ansehen",
  "demo.intro": "Diese Demo zeigt einen gemeinsamen, vollständig fiktiven Datenbestand.",
  "demo.sharedTitle": "Gemeinsamer Testbereich",
  "demo.sharedDescription": "Änderungen freigegebener Tester sind hier öffentlich sichtbar. Verwende deshalb keine echten Namen, Termine oder Notizen.",
  "demo.resetTitle": "Stündlicher Neustart",
  "demo.resetDescription": "Zur vollen UTC-Stunde werden die Beispieldaten zurückgesetzt. Angemeldete Tester müssen sich danach erneut anmelden.",
  "demo.nextReset": "Nächster Reset",
  "demo.countdown": "noch {time}",
  "demo.finalMinutesTitle": "Reset steht kurz bevor",
  "demo.finalMinutesDescription": "In weniger als fünf Minuten werden Änderungen verworfen und laufende Sitzungen beendet.",
  "demo.loading": "Demo-Daten werden geladen …",
  "demo.unavailableTitle": "Demo vorübergehend nicht verfügbar",
  "demo.unavailableDescription": "Die Daten werden gerade zurückgesetzt oder konnten nicht sicher bereitgestellt werden. Bitte versuche es gleich erneut.",
  "demo.retry": "Erneut versuchen",
  "demo.login": "Als freigegebener Tester anmelden",
  "demo.entriesTitle": "Aktuelle Beispieldaten",
  "demo.entriesDescription": "Die Termine sind öffentlich lesbar und werden regelmäßig zurückgesetzt.",
  "demo.noEntries": "Im aktuellen Beispieldatensatz sind keine Termine vorhanden.",
  "demo.moreEntries": "{count} weitere Termine werden in dieser kompakten Ansicht nicht angezeigt.",
  "demo.entryTitle": "{children} bei {party}",
  "demo.entryFallback": "Betreuungstermin",
  "demo.partyFallback": "betreuender Person",
  "demo.status.completed": "Durchgeführt",
  "demo.status.planned": "Geplant",
  "demo.status.partial": "Teilweise",
  "demo.status.cancelled": "Ausgefallen",
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
  "demo.skipToContent": "Skip to content",
  "demo.context": "Public demo",
  "demo.title": "View fictional care appointments",
  "demo.intro": "This demo shows a shared, entirely fictional dataset.",
  "demo.sharedTitle": "Shared test area",
  "demo.sharedDescription": "Changes made by approved testers are publicly visible here. Do not use real names, appointments, or notes.",
  "demo.resetTitle": "Hourly reset",
  "demo.resetDescription": "At every full UTC hour, the sample data is reset. Signed-in testers must sign in again afterwards.",
  "demo.nextReset": "Next reset",
  "demo.countdown": "{time} remaining",
  "demo.finalMinutesTitle": "Reset is about to start",
  "demo.finalMinutesDescription": "In less than five minutes, changes will be discarded and active sessions will end.",
  "demo.loading": "Loading demo data …",
  "demo.unavailableTitle": "Demo temporarily unavailable",
  "demo.unavailableDescription": "The data is being reset or could not be provided safely. Please try again shortly.",
  "demo.retry": "Try again",
  "demo.login": "Sign in as an approved tester",
  "demo.entriesTitle": "Current sample data",
  "demo.entriesDescription": "Appointments are publicly readable and reset regularly.",
  "demo.noEntries": "The current sample dataset contains no appointments.",
  "demo.moreEntries": "{count} more appointments are not shown in this compact view.",
  "demo.entryTitle": "{children} with {party}",
  "demo.entryFallback": "Care appointment",
  "demo.partyFallback": "caregiver",
  "demo.status.completed": "Completed",
  "demo.status.planned": "Planned",
  "demo.status.partial": "Partial",
  "demo.status.cancelled": "Cancelled",
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
