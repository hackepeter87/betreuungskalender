import { defaultLocale, type AppLocale } from "./resources";

type InterpolationValues = Record<string, string | number>;

const de = {
  common: {
    cancel: "Abbrechen",
    save: "Speichern",
    delete: "Löschen",
    edit: "Bearbeiten",
    add: "Hinzufügen",
    yes: "Ja",
    no: "Nein",
    from: "Von",
    to: "Bis",
    today: "Heute",
    all: "Alle",
    none: "Keine",
    unknownChild: "Unbekanntes Kind",
    noChild: "Ohne Kind",
    noNote: "Keine Notiz",
    noAdditionalInformation: "Keine ergänzende Angabe",
    notAvailable: "Nicht verfügbar"
  },
  labels: {
    completed: "Durchgeführt", planned: "Geplant", cancelled: "Ausgefallen",
    commuterApartment: "Pendlerwohnung", mainResidence: "Hauptwohnsitz", mother: "Mutter", father: "Vater", school: "Schule", ogs: "OGS", other: "Sonstiges", thirdParty: "Dritte",
    locationMother: "Bei der Mutter", otherLocation: "Anderer Ort",
    pickup: "Abholung", return: "Rückbringung", doctor: "Arzt", leisure: "Freizeit", workplace: "Dienststätte",
    food: "Verpflegung", clothing: "Kleidung", travel: "Fahrtkosten", both: "Beide", shared: "Hälftig / geteilt",
    duty: "Dienst", trainingCourse: "Lehrgang", exercise: "Übung", guardDuty: "Wachdienst", standby: "Bereitschaft", deployment: "Einsatz", businessTrip: "Dienstreise", illness: "Krankheit", privateUnavailability: "Private Nichtverfügbarkeit", vacationWithoutChildren: "Urlaub ohne Kinder"
  },
  fieldHelp: {
    helpFor: "Hilfe zu {label}", close: "Hilfe schließen", why: "Warum relevant?", usage: "Verwendung", guidance: "Eingabehinweis", mistakes: "Typische Fehler vermeiden", example: "Beispiel", reportLink: "Berichtsbezug", notice: "Die Hilfe unterstützt eine sachliche Dokumentation. Sie enthält keine Rechtsberatung und keine rechtliche Bewertung."
  },
  mobileExport: { notice: "Auf iPhone und iPad öffnet Safari Dateien je nach Format zunächst in einer Vorschau. Nutze anschließend „Teilen“ und „In Dateien sichern“." },
  dashboard: {
    context: "Monatsübersicht", closeMonth: "Monat abschließen", monthClosed: "Monat abgeschlossen", createEntry: "Eintrag erfassen", setupTitle: "Richte deinen Betreuungskalender ein", setupDescription: "Lege mindestens ein Kind an. Danach kannst du Betreuungseinträge erfassen und monatlich auswerten.", addChild: "Kind anlegen", metrics: "Monatskennzahlen", mobileMetrics: "Wichtigste Monatskennzahlen", careDays: "Betreuungstage", actualDays: "tatsächliche Kalendertage", overnights: "Übernachtungen", selectedMonth: "im gewählten Monat", weekends: "Wochenenden", documentedCare: "mit dokumentierter Betreuung", completeness: "Vollständigkeit", checkedEntries: "{count} Einträge geprüft", dataQuality: "Datenqualität", monthHints: "Hinweise im gewählten Monat", noOpenHints: "keine offenen Hinweise", additionalCare: "Zusatzbetreuung", completedDates: "durchgeführte Termine", openDates: "Offene Termine", plannedDates: "geplante Soll-Termine", openHints: "offene Hinweise", noHints: "keine Hinweise", lastBackup: "Letztes Backup", backupCurrent: "Sicherung aktuell", backupRequired: "Sicherung erforderlich", calendar: "Kalender", calendarDescription: "Einträge anklicken, um Details zu bearbeiten.", largeView: "Große Ansicht", planned: "geplant", cancelled: "ausgefallen", perChild: "Je Kind", actualCare: "Tatsächliche Betreuung", days: "Tage", nights: "Nächte", noChildren: "Noch keine Kinder angelegt.", qualityFor: "Hinweise für {month}", incompleteEntries: "Unvollständige Einträge", cancellationsWithoutReason: "Ausfälle ohne Notiz / Grund", tripsWithoutPurpose: "Fahrten ohne Zweck", costsWithoutCategory: "Kosten ohne Kategorie", overduePlanned: "Vergangene Termine noch geplant", upcoming: "Nächste Einträge", upcomingDescription: "Geplant und bevorstehend", noUpcoming: "Keine bevorstehenden Einträge.", backupUpToDate: "Backup aktuell", backupNeeded: "Backup erforderlich", latestBackup: "Letzte JSON-Sicherung: {date}.", backupDaysAgo: "Letzte Sicherung vor {days} Tagen.", noBackup: "Noch keine JSON-Sicherung dokumentiert.", closureOn: "Monatsabschluss vom {date}", closureSummary: "{entries} Einträge, {days} Betreuungstage und {overnights} Übernachtungen wurden zusammengefasst.", changedOn: " Nachträgliche Änderung am {date}.", closeTitle: "Monat {month} abschließen", closureTitle: "Monatsabschluss {month}", closedInfo: "Der Monat wurde am {date} abgeschlossen. Änderungen bleiben nach einem Warnhinweis möglich und werden protokolliert.", warningsBeforeClose: "Hinweise vor dem Abschluss", noValidationHints: "Die Plausibilitätsprüfung enthält keine offenen Hinweise.", closureDescription: "Der Abschluss speichert diese Monatszusammenfassung. Spätere Änderungen sind nur nach einem ausdrücklichen Warnhinweis möglich.", confirmed: "Ich habe die Hinweise und die Monatszusammenfassung geprüft.", finalClose: "Monat verbindlich abschließen", entries: "Einträge", completed: "Durchgeführt", plannedTitle: "Geplant", cancelledTitle: "Ausgefallen"
  },
  analytics: { context: "Zeitraumauswertung", title: "Auswertung", csvPeriod: "CSV Zeitraum", creatingPdf: "PDF wird erstellt …", pdfReport: "PDF Bericht", careDays: "Betreuungstage", careHours: "Betreuungsstunden", overnights: "Übernachtungen", additionalCare: "Zusatzbetreuung", tripKm: "Fahrtkilometer", costs: "Kosten", byChild: "Auswertung je Kind und gemeinsam", byChildDescription: "Kosten und Fahrten gemeinsamer Einträge werden in den Kinderzeilen anteilig verteilt.", analysis: "Auswertung", days: "Tage", nights: "Nächte", weekends: "Wochenenden", weekdayNights: "Wochentagsnächte", additional: "Zusätzlich", holidayDays: "Ferientage", dayQuote: "Quote Tage", nightQuote: "Quote Nächte", kilometres: "Kilometer", travelCosts: "Fahrtkosten", combined: "Gemeinsam", plannedActual: "Soll-Ist und Zusatzbetreuung", plannedActualDescription: "Termine aus der 14-Tage-Regel im Zeitraum", plannedDates: "Geplante Soll-Termine", pending: "Noch offen", completed: "Durchgeführt", cancelledDuty: "Dienstlich ausgefallen", cancelledOther: "Sonstig ausgefallen", overlaps: "Überschneidungen", trips: "Fahrten", rate: "Kilometersatz: {rate} EUR/km", drivenKm: "Gefahrene Kilometer", calculatedTravelCost: "Rechnerische Fahrtkosten", reimbursements: "Dokumentierte Erstattungen", costsByCategory: "Kosten nach Kategorie", completedEntries: "Durchgeführte Betreuungseinträge", total: "Gesamt", holidayAllocation: "Ferienaufteilung", holidayDescription: "Geteilte Tage werden hälftig angerechnet.", fatherDays: "Beim Vater", motherDays: "Bei der Mutter", fatherQuote: "Vaterquote", dutyUnavailability: "Dienstliche Nichtverfügbarkeiten", neutralTitle: "Sachliche Auswertung", neutralDescription: "Quoten beziehen sich auf alle Kalendertage beziehungsweise Nächte des gewählten Zeitraums. Die Auswertung stellt keine rechtliche Bewertung dar." },
  agenda: {
    emptyTitle: "Noch keine Einträge in diesem Monat",
    emptyDescription: "Erfasse den ersten Betreuungseintrag direkt aus der Agenda.",
    addEntry: "Eintrag hinzufügen",
    documentationCount: "{count} Dokumentationen",
    addEntryForDate: "Eintrag für {date} hinzufügen",
    dutyRelated: "Dienstlich",
    unavailable: "Nichtverfügbar",
    affectsContact: "Betrifft Umgang",
    affectsHolidays: "Betrifft Ferien",
    overnight: "Übernachtung",
    additionalCare: "Zusatzbetreuung",
    holiday: "Ferientag",
    overlap: "Dieser geplante Umgang überschneidet sich mit einer dokumentierten Nichtverfügbarkeit.",
    durationDaysHours: "{days} T. {hours} Std.",
    durationDays: "{days} Tage",
    durationHours: "{hours} Std."
  },
  calendar: {
    weekdays: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
    addEntryOnDate: "Eintrag am {date} erfassen",
    dutyAbsence: "Dienstliche Abwesenheit",
    unavailability: "Nichtverfügbarkeit",
    completed: "Durchgeführt",
    planned: "Geplant",
    cancelled: "Ausgefallen",
    bothChildren: "Beide Kinder",
    entry: "Eintrag",
    more: "+{count} weitere"
  },
  monthToolbar: {
    label: "Monatsauswahl",
    previous: "Vorheriger Monat",
    choose: "Monat auswählen",
    next: "Nächster Monat"
  },
  periodSelector: {
    label: "Auswertungszeitraum",
    month: "Monat",
    quarter: "Quartal",
    year: "Jahr",
    custom: "Frei",
    anchorMonth: "Bezugsmonat",
    startDate: "Von",
    endDate: "Bis"
  },
  entryForm: {
    childRequired: "Bitte mindestens ein Kind auswählen.",
    endAfterStart: "Das Ende muss nach dem Beginn liegen.",
    cancellationReasonRequired: "Bitte den Grund des Ausfalls dokumentieren.",
    kmPositive: "Kilometer müssen größer als 0 sein.",
    amountPositive: "Der Betrag muss größer als 0 sein.",
    fixFields: "Bitte prüfe die markierten Pflichtfelder.",
    deleteConfirm: "Diesen Betreuungseintrag als gelöscht markieren? Die Änderung bleibt im Protokoll nachvollziehbar.",
    plannedRuleTitle: "Soll-Termin aus der 14-Tage-Regel",
    plannedRuleDescription: "Der Status kann als durchgeführt oder mit Grund als ausgefallen dokumentiert werden.",
    noChildTitle: "Noch kein Kind angelegt",
    noChildDescription: "Lege zuerst unter Einstellungen ein Kind an.",
    children: "Kinder",
    statusClassification: "Status und Einordnung",
    completed: "Durchgeführt",
    planned: "Geplant",
    cancelled: "Ausgefallen",
    additionalCare: "Als zusätzliche Betreuung kennzeichnen",
    period: "Zeitraum *",
    startDate: "Beginn Datum",
    startTime: "Beginn Uhrzeit",
    endDate: "Ende Datum",
    endTime: "Ende Uhrzeit",
    overnight: "Übernachtung",
    schoolHandover: "Morgens zur Schule",
    holiday: "Ferientag",
    locationHandover: "Ort und Übergabe",
    customLocation: "Ort eintragen",
    trips: "Fahrten",
    tripsDescription: "Mehrere Fahrten können einem Betreuungseintrag zugeordnet werden.",
    addTrip: "Fahrt hinzufügen",
    trip: "Fahrt {index}",
    deleteTrip: "Fahrt {index} löschen",
    noTrips: "Keine Fahrten erfasst.",
    costs: "Kosten",
    costsDescription: "Einzelne Kostenposten bleiben mit Kategorie und Zahler nachvollziehbar.",
    addCost: "Kosten hinzufügen",
    cost: "Kostenposten {index}",
    deleteCost: "Kostenposten {index} löschen",
    noCosts: "Keine Kosten erfasst.",
    notesEvidence: "Notizen und Belege",
    notesPlaceholder: "Sachliche Hinweise zu Übergabe, Ablauf oder Abweichungen",
    evidenceReferencePlaceholder: "z. B. E-Mail vom 12.05.",
    amountEur: "Betrag in EUR",
    evidenceAvailable: "Beleg oder Dokument vorhanden",
    saveChanges: "Änderungen speichern",
    saveEntry: "Eintrag speichern",
    deleteEntry: "Eintrag löschen",
    entryFor: "Eintrag für {names}"
  },
  holiday: {
    defaultName: "Ferienblock",
    validPeriod: "Bitte einen gültigen Ferienzeitraum eingeben.",
    childRequired: "Bitte mindestens ein Kind auswählen.",
    namePlaceholder: "z. B. Sommerferien Block 1",
    children: "Kinder",
    save: "Ferienblock speichern",
    deleteConfirm: "Ferienblock „{name}“ als gelöscht markieren? Die Änderung bleibt im Protokoll erhalten.",
    context: "Ferienaufteilung",
    title: "Ferienverwaltung",
    add: "Ferienblock erfassen",
    totalDays: "Ferientage gesamt",
    fatherDays: "Beim Vater",
    motherDays: "Bei der Mutter",
    fatherQuote: "Vaterquote",
    halfDifference: "Hälfte / Abweichung",
    dutyUnavailability: "Dienstliche Nichtverfügbarkeit",
    dutyUnavailabilityDescription: "Im Ferienzeitraum lagen dokumentierte Nichtverfügbarkeiten vor. Die hälftige Ferienquote wird weiterhin aus der dokumentierten tatsächlichen Betreuung berechnet.",
    recorded: "Erfasste Ferienblöcke",
    recordedDescription: "Geteilte Tage werden bei Vater und Mutter jeweils mit einem halben Tag berücksichtigt.",
    allChildren: "Alle Kinder",
    empty: "Für den gewählten Zeitraum sind keine Ferienblöcke erfasst.",
    createTitle: "Ferienblock erfassen",
    editTitle: "Ferienblock bearbeiten",
    edit: "{name} bearbeiten",
    delete: "{name} löschen"
  },
  unavailable: {
    deleteConfirm: "Nichtverfügbarkeit als gelöscht markieren? Die Änderung bleibt im Protokoll erhalten.",
    context: "Sachliche Abwesenheitsdokumentation",
    title: "Nichtverfügbarkeiten",
    add: "Nichtverfügbarkeit erfassen",
    periods: "Zeiträume",
    dutyRelated: "Dienstlich",
    affectsContact: "Betrifft Umgang",
    affectsHolidays: "Betrifft Ferien",
    neutralTitle: "Neutrale Dokumentation",
    neutralDescription: "Dokumentierte Nichtverfügbarkeiten werden gesondert ausgewiesen und nicht automatisch als nicht wahrgenommene Betreuung bewertet.",
    recorded: "Erfasste Zeiträume",
    recordedDescription: "Dienstliche und sonstige Abwesenheiten im gewählten Zeitraum",
    other: "Sonstig",
    holidayPlanning: "Ferienplanung",
    noEffect: "Keine Auswirkung markiert",
    empty: "Für den gewählten Zeitraum sind keine Nichtverfügbarkeiten dokumentiert.",
    createTitle: "Nichtverfügbarkeit erfassen",
    editTitle: "Nichtverfügbarkeit bearbeiten",
    edit: "Nichtverfügbarkeit bearbeiten",
    delete: "Nichtverfügbarkeit löschen",
    periodCategory: "Zeitraum und Kategorie",
    effects: "Auswirkungen",
    locationNotesEvidence: "Ort, Notiz und Beleg",
    otherNoteRecommendation: "Bei „Sonstiges“ wird eine kurze Notiz empfohlen.",
    dutyEvidenceRecommendation: "Bei dienstlicher Veranlassung wird eine Belegreferenz empfohlen.",
    completePeriod: "Bitte Beginn und Ende vollständig angeben.",
    endAfterStart: "Das Ende muss nach dem Beginn liegen.",
    locationPlaceholder: "z. B. Dienststätte, Lehrgangsort",
    notesPlaceholder: "Sachliche ergänzende Angaben",
    evidencePlaceholder: "z. B. Dienstplan 06/2026",
    recommendation: "Dokumentationsempfehlung",
    save: "Nichtverfügbarkeit speichern"
  },
  settings: {
    childNamePlaceholder: "Vorname oder Kürzel", calendarColor: "Farbe im Kalender", saveChild: "Speichern", addChild: "Kind anlegen", editChild: "Kind bearbeiten", cancel: "Abbrechen", childDelete: "{name} wirklich löschen?", childDeleteAffected: "{name} ist in {count} Einträgen enthalten. Beim Löschen werden diese Zuordnungen entfernt. Fortfahren?", demoReplaceConfirm: "Beispieldaten ersetzen den aktuellen Datenbestand. Fortfahren?", clearDataConfirm: "Alle Kinder, Einträge, Monatsabschlüsse, Protokolle und Einstellungen dauerhaft aus der SQLite-Datenbank löschen? Diese Aktion ersetzt den gesamten Datenbestand.", children: "Kinder", childrenDescription: "Namen werden im lokalen SQLite-Dienst gespeichert und können auch als Kürzel geführt werden.", born: "Geboren {month}/{year}", editChildAria: "{name} bearbeiten", deleteChildAria: "{name} löschen", noChildren: "Noch kein Kind angelegt.", defaults: "Standardwerte", defaultsDescription: "Neue Einträge werden mit diesen Werten vorbelegt.", kilometerRate: "Kilometersatz in EUR", defaultHandoverFrom: "Übergabe standardmäßig von", defaultHandoverTo: "Übergabe standardmäßig an", demoData: "Beispiel- und Datenbankdaten", demoDataDescription: "Beispieldaten helfen beim Kennenlernen und können vollständig entfernt werden.", loadDemo: "Beispieldaten laden", clearData: "Alle Datenbankdaten löschen"
  },
  backup: {
    exportSuccess: "JSON-Sicherung wurde erstellt.", exportRecordedFailed: "Die Datei wurde erzeugt, der Backup-Zeitpunkt konnte jedoch nicht in SQLite gespeichert werden.", importOutdatedConfirm: "Das letzte JSON-Backup ist {days} Tage alt. Vor einem Import wird ein aktuelles Backup empfohlen. Trotzdem eine Importdatei auswählen?", importMissingConfirm: "Es wurde noch kein JSON-Backup erstellt. Vor einem Import wird ein aktuelles Backup empfohlen. Trotzdem eine Importdatei auswählen?", importReplaceConfirm: "Import ersetzt {current} vorhandene Einträge durch {imported} Einträge. Diese Wiederherstellung jetzt ausführen?", importSuccess: "Sicherung wurde erfolgreich importiert.", importFailed: "Die Datei konnte nicht importiert werden.", context: "Datensicherung", title: "Export & Import", heroTitle: "Deine Daten liegen in der lokalen SQLite-Datenbank", heroDescription: "Es gibt keine Cloud-Synchronisation. Eine regelmäßige JSON-Sicherung schützt vor Datenverlust und ermöglicht die Wiederherstellung auf einer anderen Installation.", latestBackup: "Letztes JSON-Backup: {date}", noBackupDocumented: "Noch kein JSON-Backup dokumentiert", backupCurrent: "Die letzte Sicherung ist höchstens sieben Tage alt.", backupWarning: "Die letzte Sicherung fehlt oder ist älter als sieben Tage. Bitte vor größeren Änderungen oder einem Import sichern.", exportJson: "JSON exportieren", exportDescription: "Speichert Kinder, Betreuungseinträge, Umgangsregeln, Ferien, Nichtverfügbarkeiten, Fahrten, Kosten und Einstellungen vollständig in einer Datei.", children: "Kinder", entries: "Einträge", lastChange: "Letzte Änderung", lastBackup: "Letztes Backup", none: "Noch keines", importJson: "JSON importieren", importDescription: "Lädt eine zuvor exportierte Sicherung. Die Datei wird geprüft und anschließend transaktional in SQLite wiederhergestellt.", importWarning: "Ein Import ersetzt den aktuellen Datenbestand.", chooseJson: "JSON auswählen", csvTitle: "CSV-Rohdatenexport", csvDescription: "Die Dateien sind getrennt, damit Betreuungseinträge und ihre Unterpositionen ohne Informationsverlust ausgewertet werden können.", careEntries: "Betreuungseinträge", trips: "Fahrten", costs: "Kosten", holidays: "Ferien", unavailability: "Nichtverfügbarkeiten"
  },
  calendarPage: {
    context: "Kalender", createEntry: "Eintrag erfassen", care: "Betreuung", unavailability: "Nichtverfügbarkeit", viewLabel: "Kalenderansicht", agenda: "Agenda", month: "Monat", overnight: "Übernachtung", planned: "geplant", cancelled: "ausgefallen", tip: "Tippe auf einen Tag für einen neuen Eintrag oder auf einen bestehenden Balken zum Bearbeiten.", addEntryAria: "Betreuungseintrag hinzufügen", addEntry: "Eintrag hinzufügen"
  },
  entries: {
    context: "Dokumentation", title: "Einträge · {month}", createEntry: "Eintrag erfassen", searchAria: "Einträge durchsuchen", searchPlaceholder: "Name oder Notiz suchen", all: "Alle", emptyTitle: "Keine passenden Einträge", emptyDescription: "Erfasse einen Betreuungseintrag oder ändere die Filter."
  },
  app: { createCareEntry: "Betreuungseintrag erfassen", editCareEntry: "Betreuungseintrag bearbeiten", completeness: "Vollständigkeit", school: "Schule" }
} as const;

const en = {
  ...de,
  common: { ...de.common, cancel: "Cancel", save: "Save", delete: "Delete", edit: "Edit", add: "Add", yes: "Yes", no: "No", from: "From", to: "To", today: "Today", all: "All", none: "None", unknownChild: "Unknown child", noChild: "No child", noNote: "No note", noAdditionalInformation: "No additional information", notAvailable: "Unavailable" },
  labels: { ...de.labels, completed: "Completed", planned: "Planned", cancelled: "Cancelled", commuterApartment: "Commuter apartment", mainResidence: "Main residence", mother: "Mother", father: "Father", school: "School", other: "Other", thirdParty: "Third party", locationMother: "With mother", otherLocation: "Other location", pickup: "Pick-up", return: "Return journey", doctor: "Doctor", leisure: "Leisure", workplace: "Workplace", food: "Food", clothing: "Clothing", travel: "Travel costs", both: "Both", shared: "Shared / split", duty: "Duty", trainingCourse: "Training course", exercise: "Exercise", guardDuty: "Guard duty", standby: "Standby", deployment: "Deployment", businessTrip: "Business trip", illness: "Illness", privateUnavailability: "Private unavailability", vacationWithoutChildren: "Holiday without children" },
  fieldHelp: { helpFor: "Help for {label}", close: "Close help", why: "Why this matters", usage: "Used for", guidance: "Input guidance", mistakes: "Avoid common mistakes", example: "Example", reportLink: "Report reference", notice: "The help supports factual documentation. It does not provide legal advice or a legal assessment." },
  mobileExport: { notice: "On iPhone and iPad, Safari may initially open files in a preview depending on the format. Then use “Share” and “Save to Files”." },
  dashboard: { ...de.dashboard, context: "Monthly overview", closeMonth: "Close month", monthClosed: "Month closed", createEntry: "Create entry", setupTitle: "Set up your Care Calendar", setupDescription: "Add at least one child. Then you can record care entries and review them monthly.", addChild: "Add child", metrics: "Monthly metrics", mobileMetrics: "Key monthly metrics", careDays: "Care days", actualDays: "actual calendar days", overnights: "Overnights", selectedMonth: "in the selected month", weekends: "Weekends", documentedCare: "with documented care", completeness: "Completeness", checkedEntries: "{count} entries checked", dataQuality: "Data quality", monthHints: "Notes in the selected month", noOpenHints: "no open notes", additionalCare: "Additional care", completedDates: "completed dates", openDates: "Open dates", plannedDates: "planned contact dates", openHints: "open notes", noHints: "no notes", lastBackup: "Last backup", backupCurrent: "Backup current", backupRequired: "Backup required", calendar: "Calendar", calendarDescription: "Click entries to edit details.", largeView: "Large view", planned: "planned", cancelled: "cancelled", perChild: "Per child", actualCare: "Actual care", days: "Days", nights: "Nights", noChildren: "No children added yet.", qualityFor: "Notes for {month}", incompleteEntries: "Incomplete entries", cancellationsWithoutReason: "Cancellations without note / reason", tripsWithoutPurpose: "Trips without purpose", costsWithoutCategory: "Costs without category", overduePlanned: "Past dates still planned", upcoming: "Upcoming entries", upcomingDescription: "Planned and upcoming", noUpcoming: "No upcoming entries.", backupUpToDate: "Backup current", backupNeeded: "Backup required", latestBackup: "Latest JSON backup: {date}.", backupDaysAgo: "Latest backup {days} days ago.", noBackup: "No JSON backup documented yet.", closureOn: "Month closed on {date}", closureSummary: "{entries} entries, {days} care days and {overnights} overnights were summarized.", changedOn: " Changed later on {date}.", closeTitle: "Close month {month}", closureTitle: "Month closure {month}", closedInfo: "The month was closed on {date}. Changes remain possible after a warning and are recorded.", warningsBeforeClose: "Notes before closing", noValidationHints: "The plausibility check has no open notes.", closureDescription: "Closing stores this monthly summary. Later changes require an explicit warning.", confirmed: "I reviewed the notes and monthly summary.", finalClose: "Close month definitively", entries: "Entries", completed: "Completed", plannedTitle: "Planned", cancelledTitle: "Cancelled" },
  analytics: { ...de.analytics, context: "Period analysis", title: "Analytics", csvPeriod: "Period CSV", creatingPdf: "Creating PDF …", pdfReport: "PDF report", careDays: "Care days", careHours: "Care hours", overnights: "Overnights", additionalCare: "Additional care", tripKm: "Trip kilometres", costs: "Costs", byChild: "Analysis by child and combined", byChildDescription: "Costs and trips from shared entries are allocated proportionally to child rows.", analysis: "Analysis", days: "Days", nights: "Nights", weekends: "Weekends", weekdayNights: "Weekday nights", additional: "Additional", holidayDays: "Holiday days", dayQuote: "Day share", nightQuote: "Night share", kilometres: "Kilometres", travelCosts: "Travel costs", combined: "Combined", plannedActual: "Planned/actual and additional care", plannedActualDescription: "Dates from the 14-day rule in the period", plannedDates: "Planned contact dates", pending: "Still pending", completed: "Completed", cancelledDuty: "Cancelled due to duty", cancelledOther: "Other cancellations", overlaps: "Overlaps", trips: "Trips", rate: "Rate: {rate} EUR/km", drivenKm: "Driven kilometres", calculatedTravelCost: "Calculated travel costs", reimbursements: "Documented reimbursements", costsByCategory: "Costs by category", completedEntries: "Completed care entries", total: "Total", holidayAllocation: "Holiday allocation", holidayDescription: "Shared days are counted as half a day.", fatherDays: "With father", motherDays: "With mother", fatherQuote: "Father share", dutyUnavailability: "Duty-related unavailability", neutralTitle: "Factual analysis", neutralDescription: "Shares relate to all calendar days or nights in the selected period. The analysis does not provide a legal assessment." },
  agenda: { ...de.agenda, emptyTitle: "No entries in this month yet", emptyDescription: "Create the first care entry directly from the agenda.", addEntry: "Add entry", documentationCount: "{count} records", addEntryForDate: "Add entry for {date}", dutyRelated: "Duty-related", unavailable: "Unavailable", affectsContact: "Affects contact", affectsHolidays: "Affects holidays", overnight: "Overnight", additionalCare: "Additional care", holiday: "Holiday day", overlap: "This planned contact overlaps with documented unavailability.", durationDaysHours: "{days} d {hours} h", durationDays: "{days} days", durationHours: "{hours} h" },
  calendar: { ...de.calendar, weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], addEntryOnDate: "Create entry on {date}", dutyAbsence: "Duty-related absence", unavailability: "Unavailability", completed: "Completed", planned: "Planned", cancelled: "Cancelled", bothChildren: "Both children", entry: "Entry", more: "+{count} more" },
  monthToolbar: { label: "Month selection", previous: "Previous month", choose: "Choose month", next: "Next month" },
  periodSelector: { label: "Analysis period", month: "Month", quarter: "Quarter", year: "Year", custom: "Custom", anchorMonth: "Reference month", startDate: "From", endDate: "To" },
  entryForm: { ...de.entryForm, childRequired: "Select at least one child.", endAfterStart: "The end must be after the start.", cancellationReasonRequired: "Document the reason for the cancellation.", kmPositive: "Kilometres must be greater than 0.", amountPositive: "The amount must be greater than 0.", fixFields: "Check the highlighted required fields.", deleteConfirm: "Mark this care entry as deleted? The change remains traceable in the audit log.", plannedRuleTitle: "Planned date from the 14-day rule", plannedRuleDescription: "The status can be documented as completed or cancelled with a reason.", noChildTitle: "No child added yet", noChildDescription: "First add a child in Settings.", children: "Children", statusClassification: "Status and classification", completed: "Completed", planned: "Planned", cancelled: "Cancelled", additionalCare: "Mark as additional care", period: "Period *", startDate: "Start date", startTime: "Start time", endDate: "End date", endTime: "End time", overnight: "Overnight", schoolHandover: "Morning school handover", holiday: "Holiday day", locationHandover: "Location and handover", customLocation: "Enter location", trips: "Trips", tripsDescription: "Multiple trips can be assigned to one care entry.", addTrip: "Add trip", trip: "Trip {index}", deleteTrip: "Delete trip {index}", noTrips: "No trips recorded.", costs: "Costs", costsDescription: "Individual cost items remain traceable by category and payer.", addCost: "Add cost", cost: "Cost item {index}", deleteCost: "Delete cost item {index}", noCosts: "No costs recorded.", notesEvidence: "Notes and evidence", notesPlaceholder: "Factual notes on handover, events, or deviations", evidenceReferencePlaceholder: "e.g. email dated 12 May", amountEur: "Amount in EUR", evidenceAvailable: "Evidence or document available", saveChanges: "Save changes", saveEntry: "Save entry", deleteEntry: "Delete entry", entryFor: "Entry for {names}" },
  holiday: { ...de.holiday, defaultName: "Holiday block", validPeriod: "Enter a valid holiday period.", childRequired: "Select at least one child.", namePlaceholder: "e.g. summer holiday block 1", children: "Children", save: "Save holiday block", deleteConfirm: "Mark holiday block “{name}” as deleted? The change remains in the audit log.", context: "Holiday allocation", title: "Holiday management", add: "Create holiday block", totalDays: "Total holiday days", fatherDays: "With father", motherDays: "With mother", fatherQuote: "Father share", halfDifference: "Half / difference", dutyUnavailability: "Duty-related unavailability", dutyUnavailabilityDescription: "Documented unavailability occurred during the holiday period. The half-share calculation continues to use documented actual care.", recorded: "Recorded holiday blocks", recordedDescription: "Shared days count as half a day for both father and mother.", allChildren: "All children", empty: "No holiday blocks are recorded for the selected period.", createTitle: "Create holiday block", editTitle: "Edit holiday block", edit: "Edit {name}", delete: "Delete {name}" },
  unavailable: { ...de.unavailable, deleteConfirm: "Mark unavailability as deleted? The change remains in the audit log.", context: "Factual absence documentation", title: "Unavailability", add: "Create unavailability", periods: "Periods", dutyRelated: "Duty-related", affectsContact: "Affects contact", affectsHolidays: "Affects holidays", neutralTitle: "Neutral documentation", neutralDescription: "Documented unavailability is shown separately and is not automatically assessed as missed care.", recorded: "Recorded periods", recordedDescription: "Duty-related and other absences in the selected period", other: "Other", holidayPlanning: "Holiday planning", noEffect: "No effect marked", empty: "No unavailability is documented for the selected period.", createTitle: "Create unavailability", editTitle: "Edit unavailability", edit: "Edit unavailability", delete: "Delete unavailability", periodCategory: "Period and category", effects: "Effects", locationNotesEvidence: "Location, note and evidence", otherNoteRecommendation: "A short note is recommended for “Other”.", dutyEvidenceRecommendation: "An evidence reference is recommended when duty-related.", completePeriod: "Enter a complete start and end.", endAfterStart: "The end must be after the start.", locationPlaceholder: "e.g. duty location, course location", notesPlaceholder: "Additional factual information", evidencePlaceholder: "e.g. duty roster 06/2026", recommendation: "Documentation recommendation", save: "Save unavailability" },
  settings: { ...de.settings, childNamePlaceholder: "First name or initials", calendarColor: "Calendar colour", saveChild: "Save", addChild: "Add child", editChild: "Edit child", cancel: "Cancel", childDelete: "Really delete {name}?", childDeleteAffected: "{name} is included in {count} entries. Deleting the child will remove these assignments. Continue?", demoReplaceConfirm: "Sample data will replace the current data. Continue?", clearDataConfirm: "Permanently delete all children, entries, month closures, logs, and settings from the SQLite database? This action replaces the complete data set.", children: "Children", childrenDescription: "Names are stored in the local SQLite service and can also be recorded as initials.", born: "Born {month}/{year}", editChildAria: "Edit {name}", deleteChildAria: "Delete {name}", noChildren: "No child added yet.", defaults: "Defaults", defaultsDescription: "New entries are prefilled with these values.", kilometerRate: "Kilometre rate in EUR", defaultHandoverFrom: "Default handover from", defaultHandoverTo: "Default handover to", demoData: "Sample and database data", demoDataDescription: "Sample data helps explore the app and can be removed completely.", loadDemo: "Load sample data", clearData: "Delete all database data" },
  calendarPage: { ...de.calendarPage, context: "Calendar", createEntry: "Create entry", care: "Care", unavailability: "Unavailability", viewLabel: "Calendar view", agenda: "Agenda", month: "Month", overnight: "Overnight", planned: "planned", cancelled: "cancelled", tip: "Tap a day for a new entry or an existing bar to edit it.", addEntryAria: "Add care entry", addEntry: "Add entry" },
  entries: { ...de.entries, context: "Documentation", title: "Entries · {month}", createEntry: "Create entry", searchAria: "Search entries", searchPlaceholder: "Search name or note", all: "All", emptyTitle: "No matching entries", emptyDescription: "Create a care entry or change the filters." },
  app: { ...de.app, createCareEntry: "Create care entry", editCareEntry: "Edit care entry", completeness: "Completeness", school: "School" }
};

export const catalog = { de, en } as const satisfies Record<
  AppLocale,
  Record<string, Record<string, string | readonly string[]>>
>;

export type CatalogSection = keyof typeof de;
export type CatalogKey<S extends CatalogSection> = keyof (typeof de)[S];

export function copy<S extends CatalogSection>(
  locale: AppLocale,
  section: S,
  key: CatalogKey<S>,
  values: InterpolationValues = {}
): string {
  const messages = catalog[locale] as typeof de;
  const fallback = catalog[defaultLocale] as typeof de;
  const message = String(messages[section][key] ?? fallback[section][key]);
  return message.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

export function copyList<S extends CatalogSection>(
  locale: AppLocale,
  section: S,
  key: CatalogKey<S>
): readonly string[] {
  const messages = catalog[locale] as typeof de;
  const fallback = catalog[defaultLocale] as typeof de;
  const value = messages[section][key] ?? fallback[section][key];
  return Array.isArray(value) ? value : [String(value)];
}
