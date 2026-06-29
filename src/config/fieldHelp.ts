import type { FieldHelp, RequirementLevel } from "../types";

type HelpInput = Omit<FieldHelp, "fieldId" | "commonMistakes" | "examples"> & {
  commonMistakes?: string | string[];
  examples?: string | string[];
};

function help(fieldId: string, input: HelpInput): FieldHelp {
  return {
    fieldId,
    ...input,
    commonMistakes:
      typeof input.commonMistakes === "string"
        ? [input.commonMistakes]
        : input.commonMistakes,
    examples:
      typeof input.examples === "string" ? [input.examples] : input.examples
  };
}

const required: RequirementLevel = "required";
const recommended: RequirementLevel = "recommended";
const optional: RequirementLevel = "optional";

export const fieldHelpById = {
  "child.name": help("child.name", {
    label: "Name",
    shortHelp: "Name oder eindeutiges Kürzel des Kindes.",
    whyRelevant: "Der Wert ordnet Betreuung, Ferien, Kosten und Auswertungen eindeutig einem Kind zu.",
    usedFor: "Kalender, Tageslisten, Auswertungen, Exporte und PDF-Berichte.",
    inputGuidance: "Verwende durchgängig denselben Namen oder ein verständliches Kürzel.",
    commonMistakes: "Nicht für dasselbe Kind mehrere leicht abweichende Schreibweisen anlegen.",
    requirementLevel: required,
    examples: ["Anna", "Kind A"],
    relatedReportSection: "Kinder / Zusammenfassung je Kind"
  }),
  "child.birthMonth": help("child.birthMonth", {
    label: "Geburtsmonat",
    shortHelp: "Monat der Geburt des Kindes.",
    whyRelevant: "Der Geburtsmonat hilft bei der eindeutigen Zuordnung, ohne ein vollständiges Geburtsdatum zu speichern.",
    usedFor: "Stammdaten und lokale Zuordnung.",
    inputGuidance: "Wähle den tatsächlichen Geburtsmonat.",
    commonMistakes: "Nicht den aktuellen Monat oder den Monat der Erfassung auswählen.",
    requirementLevel: required,
    examples: "März"
  }),
  "child.birthYear": help("child.birthYear", {
    label: "Geburtsjahr",
    shortHelp: "Vierstelliges Geburtsjahr des Kindes.",
    whyRelevant: "Das Jahr ergänzt die Stammdaten und erleichtert die eindeutige Zuordnung.",
    usedFor: "Stammdaten und lokale Zuordnung.",
    inputGuidance: "Trage das tatsächliche Geburtsjahr vierstellig ein.",
    commonMistakes: "Nicht das laufende Jahr oder ein Alter statt des Geburtsjahrs eintragen.",
    requirementLevel: required,
    examples: "2018"
  }),
  "child.color": help("child.color", {
    label: "Kalenderfarbe",
    shortHelp: "Farbe zur visuellen Unterscheidung des Kindes.",
    whyRelevant: "Die Farbe erleichtert die Orientierung bei mehreren Kindern.",
    usedFor: "Kalender, Listen und Auswahlkarten.",
    inputGuidance: "Wähle eine gut erkennbare Farbe. Die Bedeutung wird zusätzlich immer als Text angezeigt.",
    commonMistakes: "Nicht allein auf die Farbe als Identifikation vertrauen.",
    requirementLevel: required
  }),
  "child.active": help("child.active", {
    label: "Aktiv",
    shortHelp: "Legt fest, ob das Kind in neuen Auswahllisten angeboten wird.",
    whyRelevant: "Inaktive Stammdaten können erhalten bleiben, ohne neue Erfassungen zu überladen.",
    usedFor: "Auswahllisten und neue Einträge.",
    inputGuidance: "Nur deaktivieren, wenn für das Kind vorerst keine neuen Einträge erfasst werden sollen.",
    commonMistakes: "Nicht löschen, wenn historische Einträge weiter nachvollziehbar bleiben sollen.",
    requirementLevel: optional
  }),

  "careEntry.children": help("careEntry.children", {
    label: "Kind / Kinder",
    shortHelp: "Kinder, für die dieser Betreuungseintrag gilt.",
    whyRelevant: "Ohne Zuordnung kann der Eintrag nicht kindbezogen ausgewertet werden.",
    usedFor: "Kalender, Tageslisten, Quoten, Exporte und Berichte je Kind.",
    inputGuidance: "Wähle nur die Kinder aus, die im angegebenen Zeitraum tatsächlich betroffen waren.",
    commonMistakes: "Geschwister nicht pauschal gemeinsam auswählen, wenn die Zeiten voneinander abweichen.",
    requirementLevel: required,
    relatedReportSection: "Zusammenfassung je Kind / Tagesliste"
  }),
  "careEntry.startDateTime": help("careEntry.startDateTime", {
    label: "Beginn",
    shortHelp: "Zeitpunkt, ab dem die Betreuung tatsächlich begonnen hat.",
    whyRelevant: "Beginn und Ende bestimmen die dokumentierte Dauer der Betreuung.",
    usedFor: "Tageslisten, Stundenberechnung, Soll-Ist-Abgleich und Berichte.",
    inputGuidance: "Trage bei durchgeführten Terminen den tatsächlichen Beginn ein, nicht nur die ursprünglich geplante Uhrzeit.",
    commonMistakes: "Keine ungefähre Zeit eintragen, wenn die genaue Uhrzeit bekannt ist.",
    requirementLevel: required,
    examples: "14.03.2026, 17:00",
    relatedReportSection: "Tagesliste / Betreuungsdauer"
  }),
  "careEntry.endDateTime": help("careEntry.endDateTime", {
    label: "Ende",
    shortHelp: "Zeitpunkt, zu dem die dokumentierte Betreuung geendet hat.",
    whyRelevant: "Das Ende bestimmt zusammen mit dem Beginn Dauer und betroffene Kalendertage.",
    usedFor: "Tageslisten, Stundenberechnung, Übernachtungen und Berichte.",
    inputGuidance: "Trage das tatsächliche Ende ein. Bei Übernachtungen liegt es regelmäßig am Folgetag.",
    commonMistakes: ["Das Ende nicht vor oder gleich dem Beginn setzen.", "Eine Übernachtung nicht am selben Abend enden lassen."],
    requirementLevel: required,
    examples: "15.03.2026, 09:00",
    relatedReportSection: "Tagesliste / Betreuungsdauer"
  }),
  "careEntry.status": help("careEntry.status", {
    label: "Status",
    shortHelp: "Zeigt, ob der Termin geplant, durchgeführt oder ausgefallen ist.",
    whyRelevant: "Der Status trennt Planung und tatsächliches Geschehen im Soll-Ist-Vergleich.",
    usedFor: "Soll-Ist-Auswertung, Datenqualität, Monatsabschluss und Bericht.",
    inputGuidance: "Aktualisiere geplante Termine zeitnah auf durchgeführt oder ausgefallen.",
    commonMistakes: "Einen ausgefallenen Termin nicht löschen, sondern mit Status und Grund dokumentieren.",
    requirementLevel: required,
    relatedReportSection: "Soll-Ist-Abweichungen / Tagesliste"
  }),
  "careEntry.cancellationReason": help("careEntry.cancellationReason", {
    label: "Ausfallgrund",
    shortHelp: "Sachliche Angabe, warum ein geplanter Termin nicht stattgefunden hat.",
    whyRelevant: "Der Grund macht Soll-Ist-Abweichungen nachvollziehbar.",
    usedFor: "Soll-Ist-Bericht, Tagesliste, Datenqualität und PDF.",
    inputGuidance: "Beschreibe den bekannten Grund knapp und ohne Bewertung anderer Personen.",
    commonMistakes: "Keine Vorwürfe oder Vermutungen eintragen; besser „dienstliche Abwesenheit“ als eine wertende Formulierung.",
    requirementLevel: required,
    examples: ["Dienstliche Abwesenheit", "Kind erkrankt"],
    relatedReportSection: "Soll-Ist-Abweichungen / Ausfallgründe"
  }),
  "careEntry.scope": help("careEntry.scope", {
    label: "Betreuungsumfang",
    shortHelp: "Art und Umfang des tatsächlichen Kontakts oder der Betreuung.",
    whyRelevant: "Übernachtungen, volle Betreuungstage und kurze Kontaktzeiten dürfen nicht gleich dargestellt werden.",
    usedFor: "Detaillierte Auswertungen und sachliche Berichte.",
    inputGuidance: "Wähle die engste passende Einordnung: ganztägig, halbtägig, stundenweise, Abend, Besuch/Kontakt, Freizeitkontakt, Abholung, Bringung, Begleitung oder sonstiges.",
    commonMistakes: "Kurze Kontakte, Spaziergänge oder Abholungen nicht als volle Betreuungstage eintragen.",
    requirementLevel: recommended,
    examples: ["Stundenweise Betreuung", "Besuch/Kontaktzeit", "Schul-/OGS-Abholung"],
    relatedReportSection: "Betreuungsumfang"
  }),
  "careEntry.overnight": help("careEntry.overnight", {
    label: "Übernachtung",
    shortHelp: "Nur aktivieren, wenn das Kind im Zeitraum tatsächlich übernachtet hat.",
    whyRelevant: "Übernachtungen werden als eigene zentrale Kennzahl ausgewiesen.",
    usedFor: "Übernachtungsquote, Monats- und Jahresauswertung sowie PDF.",
    inputGuidance: "Aktiviere das Feld nur bei tatsächlichem Schlafen über Nacht.",
    commonMistakes: "Abendbetreuung ohne Übernachtung nicht als Übernachtung markieren.",
    requirementLevel: required,
    relatedReportSection: "Übernachtungen"
  }),
  "careEntry.schoolHandover": help("careEntry.schoolHandover", {
    label: "Schul-/OGS-Übergabe",
    shortHelp: "Kennzeichnet eine Übergabe über Schule oder OGS.",
    whyRelevant: "Die Kennzeichnung macht den Übergabeverlauf nachvollziehbar.",
    usedFor: "Tagesliste und ergänzende Auswertungen.",
    inputGuidance: "Aktiviere sie nur, wenn Schule oder OGS tatsächlich Teil der Übergabe war.",
    commonMistakes: "Eine gewöhnliche direkte Übergabe nicht als Schulübergabe markieren.",
    requirementLevel: optional
  }),
  "careEntry.holiday": help("careEntry.holiday", {
    label: "Ferienbetreuung",
    shortHelp: "Kennzeichnet Betreuung innerhalb eines Ferienzeitraums.",
    whyRelevant: "Ferienbetreuung wird getrennt von der laufenden Umgangsregel ausgewertet.",
    usedFor: "Ferienauswertung und Bericht.",
    inputGuidance: "Aktiviere die Kennzeichnung bei tatsächlicher Betreuung im erfassten Ferienblock.",
    commonMistakes: "Einen bloß geplanten Ferienanteil nicht als tatsächliche Ferienbetreuung markieren.",
    requirementLevel: optional,
    relatedReportSection: "Ferientage"
  }),
  "careEntry.weekend": help("careEntry.weekend", {
    label: "Wochenende",
    shortHelp: "Kennzeichnet einen Zeitraum mit Samstag oder Sonntag.",
    whyRelevant: "Wochenenden werden gesondert gezählt.",
    usedFor: "Monatsauswertung und Bericht.",
    inputGuidance: "Die App leitet die Kennzeichnung aus dem Zeitraum ab.",
    commonMistakes: "Nicht unabhängig vom erfassten Zeitraum bewerten.",
    requirementLevel: optional,
    relatedReportSection: "Wochenenden"
  }),
  "careEntry.additionalCare": help("careEntry.additionalCare", {
    label: "Zusatzbetreuung",
    shortHelp: "Betreuung außerhalb eines regelmäßigen Soll-Termins oder Ferienplans.",
    whyRelevant: "Zusätzliche Betreuung wird getrennt von Regelterminen ausgewiesen.",
    usedFor: "Soll-Ist-Auswertung, Monatsauswertung und PDF.",
    inputGuidance: "Aktiviere sie nur für tatsächlich zusätzliche Termine.",
    commonMistakes: "Regelwochenenden nicht zusätzlich als Zusatzbetreuung markieren.",
    requirementLevel: recommended,
    relatedReportSection: "Zusatzbetreuung"
  }),
  "careEntry.location": help("careEntry.location", {
    label: "Betreuungsort",
    shortHelp: "Ort, an dem die Betreuung überwiegend stattgefunden hat.",
    whyRelevant: "Der Ort ergänzt den sachlichen Ablauf des Eintrags.",
    usedFor: "Tagesliste und PDF-Bericht.",
    inputGuidance: "Wähle den passenden Standardort oder „Anderer Ort“.",
    commonMistakes: "Nicht den Übergabeort wählen, wenn die Betreuung überwiegend woanders stattfand.",
    requirementLevel: required,
    relatedReportSection: "Tagesliste"
  }),
  "careEntry.customLocation": help("careEntry.customLocation", {
    label: "Anderer Betreuungsort",
    shortHelp: "Konkrete Bezeichnung, wenn kein Standardort passt.",
    whyRelevant: "Eine eindeutige Ortsangabe macht den Eintrag nachvollziehbar.",
    usedFor: "Tagesliste und PDF-Bericht.",
    inputGuidance: "Nenne den Ort knapp, zum Beispiel „Sporthalle Nord“.",
    commonMistakes: "Keine unnötigen privaten Adressdetails eintragen.",
    requirementLevel: recommended,
    examples: "Sporthalle Nord"
  }),
  "careEntry.handoverFrom": help("careEntry.handoverFrom", {
    label: "Übergabe von",
    shortHelp: "Person oder Stelle, von der die Betreuung übernommen wurde.",
    whyRelevant: "Die Angabe beschreibt den Beginn des tatsächlichen Ablaufs.",
    usedFor: "Tagesliste und Nachvollziehbarkeit.",
    inputGuidance: "Wähle die tatsächlich beteiligte Person oder Stelle.",
    commonMistakes: "Nicht die ursprünglich geplante Übergabe eintragen, wenn sie anders stattfand.",
    requirementLevel: recommended
  }),
  "careEntry.handoverTo": help("careEntry.handoverTo", {
    label: "Übergabe an",
    shortHelp: "Person oder Stelle, an die am Ende übergeben wurde.",
    whyRelevant: "Die Angabe beschreibt das tatsächliche Ende des Ablaufs.",
    usedFor: "Tagesliste und Nachvollziehbarkeit.",
    inputGuidance: "Wähle die tatsächlich beteiligte Person oder Stelle.",
    commonMistakes: "Nicht die geplante Übergabe eintragen, wenn sie tatsächlich anders erfolgte.",
    requirementLevel: recommended
  }),
  "careEntry.notes": help("careEntry.notes", {
    label: "Notizen",
    shortHelp: "Sachliche ergänzende Tatsachen zum Betreuungseintrag.",
    whyRelevant: "Notizen können Besonderheiten erklären, die strukturierte Felder nicht abbilden.",
    usedFor: "Tagesliste und optionaler PDF-Inhalt.",
    inputGuidance: "Formuliere knapp, konkret und zeitbezogen.",
    commonMistakes: ["Keine emotionalen Bewertungen.", "Keine Vorwürfe oder ungesicherten Vermutungen."],
    requirementLevel: optional,
    examples: "Abholung nach Schulveranstaltung um 18:10 Uhr.",
    relatedReportSection: "Notizen"
  }),
  "careEntry.hasEvidence": help("careEntry.hasEvidence", {
    label: "Beleg vorhanden",
    shortHelp: "Zeigt an, dass ein externer Nachweis zum Eintrag existiert.",
    whyRelevant: "Die Kennzeichnung erleichtert das spätere Auffinden ergänzender Unterlagen.",
    usedFor: "Dokumentationsprüfung und Bericht.",
    inputGuidance: "Aktiviere sie nur, wenn der Beleg außerhalb der App tatsächlich gespeichert ist.",
    commonMistakes: "Die App speichert mit der Kennzeichnung nicht automatisch eine Datei.",
    requirementLevel: optional
  }),
  "careEntry.evidenceReference": help("careEntry.evidenceReference", {
    label: "Belegreferenz",
    shortHelp: "Dateiname oder eindeutige Referenz zu einem extern gespeicherten Nachweis.",
    whyRelevant: "Eine eindeutige Referenz macht Belege später auffindbar.",
    usedFor: "Tagesliste, PDF und Dokumentationsprüfung.",
    inputGuidance: "Verwende einen konkreten Dateinamen oder eine feste Ablagereferenz.",
    commonMistakes: "Nicht nur „E-Mail“ oder „WhatsApp“ eintragen.",
    requirementLevel: recommended,
    examples: "2026-03-14_umgangsabsprache.pdf",
    relatedReportSection: "Belege / Tagesliste"
  }),

  "trip.purpose": help("trip.purpose", {
    label: "Fahrtzweck",
    shortHelp: "Konkreter betreuungsbezogener Anlass der Fahrt.",
    whyRelevant: "Der Zweck ordnet Kilometer einem nachvollziehbaren Betreuungsvorgang zu.",
    usedFor: "Fahrtenauswertung, CSV und PDF.",
    inputGuidance: "Wähle Abholung, Rückfahrt, Schule, Arzt, Freizeit, Dienstort oder Sonstiges.",
    commonMistakes: "Keine privaten, nicht betreuungsbezogenen Fahrten erfassen.",
    requirementLevel: required,
    relatedReportSection: "Fahrten"
  }),
  "trip.km": help("trip.km", {
    label: "Kilometer",
    shortHelp: "Tatsächlich gefahrene Kilometer dieser einzelnen Fahrt.",
    whyRelevant: "Kilometer bilden die Grundlage für Statistik und rechnerische Fahrtkosten.",
    usedFor: "Fahrtenauswertung, Kilometersatz, CSV und PDF.",
    inputGuidance: "Trage eine realistische Strecke als Zahl größer als null ein.",
    commonMistakes: "Nicht pauschal alle privaten Fahrten oder geschätzte Monatswerte eintragen.",
    requirementLevel: required,
    examples: "24,5",
    relatedReportSection: "Fahrtkilometer"
  }),
  "trip.ownCar": help("trip.ownCar", {
    label: "Eigener Pkw",
    shortHelp: "Kennzeichnet, ob die Fahrt mit dem eigenen Pkw erfolgte.",
    whyRelevant: "Die Angabe unterscheidet eigene Fahrzeugnutzung von anderen Verkehrsmitteln.",
    usedFor: "Fahrtenliste und Kostennachvollziehbarkeit.",
    inputGuidance: "Nur aktivieren, wenn tatsächlich ein eigener Pkw genutzt wurde.",
    commonMistakes: "Mitfahrten oder öffentliche Verkehrsmittel nicht als eigenen Pkw markieren.",
    requirementLevel: required
  }),
  "trip.reimbursed": help("trip.reimbursed", {
    label: "Erstattet",
    shortHelp: "Kennzeichnet, ob für die Fahrt eine Erstattung erfolgt ist.",
    whyRelevant: "Erstattete und selbst getragene Fahrtkosten bleiben unterscheidbar.",
    usedFor: "Fahrten- und Kostenauswertung.",
    inputGuidance: "Aktiviere das Feld erst bei tatsächlich erfolgter Erstattung.",
    commonMistakes: "Eine beantragte, aber noch nicht gezahlte Erstattung nicht als erstattet markieren.",
    requirementLevel: required
  }),
  "trip.reimbursementAmount": help("trip.reimbursementAmount", {
    label: "Erstattungsbetrag",
    shortHelp: "Tatsächlich erstatteter Geldbetrag für diese Fahrt.",
    whyRelevant: "Der Betrag dokumentiert die konkrete Erstattung getrennt von rechnerischen Fahrtkosten.",
    usedFor: "Fahrtenliste und Kostenübersicht.",
    inputGuidance: "Trage nur den tatsächlich erhaltenen Betrag ein.",
    commonMistakes: "Nicht den rechnerischen Kilometerwert eintragen, wenn keine Erstattung erfolgte.",
    requirementLevel: required,
    examples: "12,50 €"
  }),
  "trip.notes": help("trip.notes", {
    label: "Fahrtnotiz",
    shortHelp: "Sachliche Ergänzung zur einzelnen Fahrt.",
    whyRelevant: "Die Notiz kann Strecke oder Besonderheiten nachvollziehbar machen.",
    usedFor: "CSV-Rohdaten und Detailprüfung.",
    inputGuidance: "Beschreibe nur relevante Fakten, etwa Start und Ziel.",
    commonMistakes: "Keine allgemeinen Betreuungsvorwürfe in einer Fahrtnotiz dokumentieren.",
    requirementLevel: optional,
    examples: "Wohnung – Schule – Wohnung"
  }),

  "cost.category": help("cost.category", {
    label: "Kostenkategorie",
    shortHelp: "Sachliche Einordnung des Kostenpostens.",
    whyRelevant: "Kategorien ermöglichen getrennte Monats- und Jahresauswertungen.",
    usedFor: "Kostenübersicht, CSV und PDF.",
    inputGuidance: "Wähle Verpflegung, Freizeit, Schule, Kleidung, Fahrtkosten oder Sonstiges.",
    commonMistakes: "Ähnliche Kosten nicht ohne Grund wechselnden Kategorien zuordnen.",
    requirementLevel: required,
    relatedReportSection: "Kosten"
  }),
  "cost.amount": help("cost.amount", {
    label: "Kostenbetrag",
    shortHelp: "Tatsächlich angefallener konkreter Betrag.",
    whyRelevant: "Der Betrag wird in Monats-, Jahres- und Berichtssummen verwendet.",
    usedFor: "Kostenstatistik, CSV und PDF.",
    inputGuidance: "Trage den belegbaren Betrag größer als null ein.",
    commonMistakes: "Keine geschätzten Pauschalen ohne konkrete Grundlage eintragen.",
    requirementLevel: required,
    examples: "18,90 €",
    relatedReportSection: "Kosten"
  }),
  "cost.paidBy": help("cost.paidBy", {
    label: "Gezahlt von",
    shortHelp: "Person oder Stelle, die den Betrag tatsächlich bezahlt hat.",
    whyRelevant: "Die Angabe trennt Kostenhöhe und zahlende Person.",
    usedFor: "Kostendetails, CSV und PDF.",
    inputGuidance: "Wähle die tatsächliche Zahlung, nicht die geplante Kostenverteilung.",
    commonMistakes: "Eine erwartete spätere Erstattung ändert nicht, wer zunächst gezahlt hat.",
    requirementLevel: required
  }),
  "cost.notes": help("cost.notes", {
    label: "Kostennotiz",
    shortHelp: "Kurze Beschreibung des konkreten Kostenanlasses.",
    whyRelevant: "Die Notiz macht den Betrag später leichter nachvollziehbar.",
    usedFor: "Kostendetails und CSV.",
    inputGuidance: "Nenne Gegenstand oder Anlass sachlich.",
    commonMistakes: "Keine pauschalen oder wertenden Aussagen verwenden.",
    requirementLevel: recommended,
    examples: "Eintritt Schwimmbad, 2 Kinder"
  }),

  "holiday.name": help("holiday.name", {
    label: "Ferienbezeichnung",
    shortHelp: "Eindeutiger Name des Ferienblocks.",
    whyRelevant: "Der Name unterscheidet mehrere Ferienzeiträume und Teilblöcke.",
    usedFor: "Ferienverwaltung, Auswertung und Export.",
    inputGuidance: "Nenne Ferienart und gegebenenfalls den Block.",
    commonMistakes: "Nicht mehrere unterschiedliche Zeiträume unter demselben unklaren Namen führen.",
    requirementLevel: required,
    examples: "Sommerferien Block 1"
  }),
  "holiday.startDate": help("holiday.startDate", {
    label: "Ferienbeginn",
    shortHelp: "Erster Kalendertag des Ferienblocks.",
    whyRelevant: "Beginn und Ende bestimmen die Zahl der Ferientage.",
    usedFor: "Ferientage, hälftige Berechnung und Bericht.",
    inputGuidance: "Trage den ersten Tag des erfassten Blocks ein.",
    commonMistakes: "Nicht den ersten Betreuungstag eintragen, wenn der Ferienblock früher beginnt.",
    requirementLevel: required,
    relatedReportSection: "Ferientage"
  }),
  "holiday.endDate": help("holiday.endDate", {
    label: "Ferienende",
    shortHelp: "Letzter Kalendertag des Ferienblocks.",
    whyRelevant: "Der Zeitraum wird einschließlich dieses Tages berechnet.",
    usedFor: "Ferientage, hälftige Berechnung und Bericht.",
    inputGuidance: "Trage den letzten Tag des Blocks ein.",
    commonMistakes: "Das Ende darf nicht vor dem Beginn liegen.",
    requirementLevel: required,
    relatedReportSection: "Ferientage"
  }),
  "holiday.assignedTo": help("holiday.assignedTo", {
    label: "Zuordnung",
    shortHelp: "Ordnet den Ferienblock Vater, Mutter oder beiden geteilt zu.",
    whyRelevant: "Die Zuordnung bildet die Ferienplanung getrennt von tatsächlicher Betreuung ab.",
    usedFor: "Ferienübersicht und rechnerische Aufteilung.",
    inputGuidance: "Wähle die dokumentierte Zuordnung des Blocks.",
    commonMistakes: "Planung nicht mit tatsächlicher Betreuung verwechseln; die Quote basiert weiterhin auf dokumentierten Einträgen.",
    requirementLevel: required
  }),
  "holiday.children": help("holiday.children", {
    label: "Kinder im Ferienblock",
    shortHelp: "Kinder, für die der Ferienblock gilt.",
    whyRelevant: "Ferienzeiträume können je Kind unterschiedlich sein.",
    usedFor: "Kindbezogene Ferienauswertung und Bericht.",
    inputGuidance: "Wähle nur tatsächlich betroffene Kinder.",
    commonMistakes: "Nicht automatisch alle Kinder auswählen, wenn Zeiträume abweichen.",
    requirementLevel: required
  }),
  "holiday.notes": help("holiday.notes", {
    label: "Feriennotiz",
    shortHelp: "Sachliche Ergänzung zur Planung oder Aufteilung.",
    whyRelevant: "Die Notiz kann Besonderheiten eines Blocks erklären.",
    usedFor: "Ferienliste und Export.",
    inputGuidance: "Beschreibe konkrete Absprachen oder Teilungen neutral.",
    commonMistakes: "Keine Bewertungen oder Vermutungen eintragen.",
    requirementLevel: optional
  }),

  "contactPattern.name": help("contactPattern.name", {
    label: "Name der Regel",
    shortHelp: "Eindeutige Bezeichnung der 14-Tage-Regel.",
    whyRelevant: "Der Name ordnet automatisch erzeugte Soll-Termine ihrer Regel zu.",
    usedFor: "Soll-Termine, Änderungsprotokoll und Verwaltung.",
    inputGuidance: "Verwende eine dauerhaft verständliche Bezeichnung.",
    commonMistakes: "Den Namen nicht für wechselnde Rhythmen wiederverwenden, ohne die Regel zu prüfen.",
    requirementLevel: required,
    examples: "14-Tage-Regel Freitag bis Sonntag"
  }),
  "contactPattern.startDate": help("contactPattern.startDate", {
    label: "Startdatum des Rhythmus",
    shortHelp: "Freitag, an dem der 14-Tage-Rhythmus beginnt.",
    whyRelevant: "Von diesem Datum werden alle weiteren Soll-Wochenenden berechnet.",
    usedFor: "Automatische Generierung geplanter Umgangstermine.",
    inputGuidance: "Wähle einen tatsächlich vereinbarten Startfreitag.",
    commonMistakes: "Keinen beliebigen Tag oder den Tag der Dateneingabe verwenden.",
    requirementLevel: required
  }),
  "contactPattern.frequency": help("contactPattern.frequency", {
    label: "Frequenz",
    shortHelp: "Zeitlicher Abstand zwischen den geplanten Terminen.",
    whyRelevant: "Die Frequenz bestimmt den Rhythmus der Soll-Termine.",
    usedFor: "Terminberechnung.",
    inputGuidance: "Die aktuelle Regel verwendet einen festen 14-Tage-Rhythmus.",
    commonMistakes: "Einzelne Abweichungen nicht durch Verschieben der gesamten Regel abbilden.",
    requirementLevel: required
  }),
  "contactPattern.fridayStartTime": help("contactPattern.fridayStartTime", {
    label: "Freitag-Beginn",
    shortHelp: "Geplante Startzeit jedes Regelwochenendes.",
    whyRelevant: "Die Uhrzeit wird für automatisch erzeugte Soll-Termine verwendet.",
    usedFor: "Soll-Termin und Soll-Ist-Vergleich.",
    inputGuidance: "Trage die regulär geplante Uhrzeit ein.",
    commonMistakes: "Tatsächliche Abweichungen einzelner Termine nicht hier nachtragen.",
    requirementLevel: required
  }),
  "contactPattern.sundayEndTime": help("contactPattern.sundayEndTime", {
    label: "Sonntag-Ende",
    shortHelp: "Geplante Endzeit jedes Regelwochenendes.",
    whyRelevant: "Die Uhrzeit vervollständigt den automatisch erzeugten Soll-Zeitraum.",
    usedFor: "Soll-Termin und Soll-Ist-Vergleich.",
    inputGuidance: "Trage die regulär geplante Endzeit ein.",
    commonMistakes: "Einzelne tatsächliche Abweichungen im Betreuungseintrag dokumentieren.",
    requirementLevel: required
  }),
  "contactPattern.children": help("contactPattern.children", {
    label: "Betroffene Kinder",
    shortHelp: "Kinder, für die die Umgangsregel Soll-Termine erzeugt.",
    whyRelevant: "Die Regel muss eindeutig den betroffenen Kindern zugeordnet sein.",
    usedFor: "Automatisch erzeugte Termine und kindbezogene Auswertung.",
    inputGuidance: "Wähle nur Kinder mit demselben Rhythmus.",
    commonMistakes: "Unterschiedliche Regelungen nicht in einer gemeinsamen Regel vermischen.",
    requirementLevel: required
  }),
  "contactPattern.active": help("contactPattern.active", {
    label: "Regel aktiv",
    shortHelp: "Steuert, ob die Regel für neue Generierungen verwendet werden soll.",
    whyRelevant: "Historische Soll-Termine bleiben erhalten, auch wenn die Regel deaktiviert wird.",
    usedFor: "Terminverwaltung.",
    inputGuidance: "Deaktiviere eine nicht mehr geltende Regel, statt historische Termine zu löschen.",
    commonMistakes: "Deaktivieren löscht keine bereits erzeugten Termine.",
    requirementLevel: required
  }),
  "contactPattern.generationRange": help("contactPattern.generationRange", {
    label: "Generierungszeitraum",
    shortHelp: "Zeitraum, für den geplante Soll-Termine erzeugt werden.",
    whyRelevant: "Die Begrenzung verhindert unnötige oder zu weit vorausliegende Termine.",
    usedFor: "Automatische Soll-Termin-Erzeugung.",
    inputGuidance: "Wähle einen überschaubaren Zeitraum und prüfe ihn vor der Erzeugung.",
    commonMistakes: "Das Ende darf nicht vor dem Beginn liegen.",
    requirementLevel: required
  }),
  "contactPattern.duplicatePrevention": help("contactPattern.duplicatePrevention", {
    label: "Duplikatvermeidung",
    shortHelp: "Bereits vorhandene Termine derselben Regel werden nicht erneut erzeugt.",
    whyRelevant: "Mehrfache Soll-Termine würden Auswertungen verfälschen.",
    usedFor: "Automatische Termin-Erzeugung.",
    inputGuidance: "Prüfe nach der Generierung die Terminliste; vorhandene Einträge bleiben unverändert.",
    commonMistakes: "Nicht manuell doppelte Soll-Termine für denselben Zeitraum anlegen.",
    requirementLevel: required
  }),
  "contactPattern.confirmCompleted": help("contactPattern.confirmCompleted", {
    label: "Durchführung bestätigen",
    shortHelp: "Setzt einen geplanten Soll-Termin auf tatsächlich durchgeführt.",
    whyRelevant: "Nur aktualisierte Statuswerte ermöglichen einen belastbaren Soll-Ist-Vergleich.",
    usedFor: "Soll-Ist-Auswertung und Monatsabschluss.",
    inputGuidance: "Bestätige erst nach dem tatsächlichen Termin und korrigiere bei Bedarf die realen Zeiten.",
    commonMistakes: "Nicht vorab als durchgeführt markieren.",
    requirementLevel: required
  }),
  "contactPattern.markCancelled": help("contactPattern.markCancelled", {
    label: "Ausfall markieren",
    shortHelp: "Dokumentiert einen nicht stattgefundenen Soll-Termin mit Grund.",
    whyRelevant: "Der Termin bleibt für den Soll-Ist-Vergleich sichtbar.",
    usedFor: "Ausfallstatistik, Bericht und Datenqualität.",
    inputGuidance: "Wähle ausgefallen und trage einen sachlichen Grund ein.",
    commonMistakes: "Einen ausgefallenen Termin nicht löschen.",
    requirementLevel: required
  }),

  "unavailable.startDateTime": help("unavailable.startDateTime", {
    label: "Beginn der Nichtverfügbarkeit",
    shortHelp: "Tatsächlicher Start des Zeitraums, in dem keine Verfügbarkeit bestand.",
    whyRelevant: "Der Beginn ermöglicht die Erkennung zeitlicher Überschneidungen.",
    usedFor: "Kalender, Soll-Ist-Hinweise, Ferienhinweise und PDF.",
    inputGuidance: "Trage den konkreten Beginn der dokumentierten Abwesenheit ein.",
    commonMistakes: "Nicht pauschal einen ganzen Monat erfassen, wenn nur einzelne Zeiten betroffen waren.",
    requirementLevel: required,
    relatedReportSection: "Dienstlich bedingte Nichtverfügbarkeit"
  }),
  "unavailable.endDateTime": help("unavailable.endDateTime", {
    label: "Ende der Nichtverfügbarkeit",
    shortHelp: "Tatsächliches Ende des dokumentierten Zeitraums.",
    whyRelevant: "Das Ende begrenzt Überschneidungen mit Umgang und Ferien.",
    usedFor: "Kalender, Soll-Ist-Hinweise, Ferienhinweise und PDF.",
    inputGuidance: "Trage das konkrete Ende ein.",
    commonMistakes: "Das Ende muss nach dem Beginn liegen.",
    requirementLevel: required,
    relatedReportSection: "Dienstlich bedingte Nichtverfügbarkeit"
  }),
  "unavailable.category": help("unavailable.category", {
    label: "Kategorie",
    shortHelp: "Sachliche Art der Nichtverfügbarkeit, etwa Dienst, Lehrgang, Einsatz oder Krankheit.",
    whyRelevant: "Die Kategorie trennt dienstliche und sonstige Gründe nachvollziehbar.",
    usedFor: "Kalender, Auswertung, CSV und PDF.",
    inputGuidance: "Wähle die engste passende Kategorie; erläutere „Sonstiges“ in der Notiz.",
    commonMistakes: "Nichtverfügbarkeit nicht automatisch als ausgefallenen Umgang eintragen, wenn kein Umgang geplant war.",
    requirementLevel: required,
    relatedReportSection: "Dienstlich bedingte Nichtverfügbarkeit"
  }),
  "unavailable.dutyRelated": help("unavailable.dutyRelated", {
    label: "Dienstlich veranlasst",
    shortHelp: "Kennzeichnet eine durch Dienst, Lehrgang, Übung, Wache, Bereitschaft, Einsatz oder Dienstreise bedingte Abwesenheit.",
    whyRelevant: "Dienstliche Gründe werden getrennt von sonstigen Nichtverfügbarkeiten ausgewiesen.",
    usedFor: "Soll-Ist-Auswertung, Ferienhinweis und PDF.",
    inputGuidance: "Aktiviere das Feld nur bei tatsächlichem dienstlichem Zusammenhang.",
    commonMistakes: "Die Kennzeichnung ist keine automatische Bewertung eines Umgangsausfalls.",
    requirementLevel: required,
    relatedReportSection: "Dienstlich bedingte Nichtverfügbarkeit"
  }),
  "unavailable.affectsContact": help("unavailable.affectsContact", {
    label: "Betrifft Umgang",
    shortHelp: "Markiert die Abwesenheit für Soll-Ist-Hinweise, wenn sie mit geplanten Umgangsterminen zusammenhängt.",
    whyRelevant: "Die App kann Überschneidungen finden und diese getrennt ausweisen, ohne daraus eine Bewertung abzuleiten.",
    usedFor: "Soll-Ist-Hinweise und Bericht.",
    inputGuidance: "Prüfe die abgeleiteten Überschneidungshinweise im Formular und aktiviere das Feld nur bei sachlichem Bezug.",
    commonMistakes: "Keinen Umgangsausfall ableiten, wenn gar kein Soll-Termin bestand.",
    requirementLevel: required
  }),
  "unavailable.affectsHolidays": help("unavailable.affectsHolidays", {
    label: "Betrifft Ferienplanung",
    shortHelp: "Markiert die Abwesenheit für Ferienhinweise, wenn sie mit dokumentierten Ferienblöcken zusammenhängt.",
    whyRelevant: "Der Ferienbericht kann dokumentierte Nichtverfügbarkeiten gesondert erwähnen.",
    usedFor: "Ferienauswertung und PDF.",
    inputGuidance: "Prüfe die abgeleiteten Überschneidungshinweise im Formular und aktiviere das Feld nur bei tatsächlichem Bezug zur Ferienplanung.",
    commonMistakes: "Die tatsächliche Ferienquote wird dadurch nicht automatisch verändert.",
    requirementLevel: required
  }),
  "unavailable.location": help("unavailable.location", {
    label: "Ort",
    shortHelp: "Ort der dokumentierten Abwesenheit, soweit für die Nachvollziehbarkeit sinnvoll.",
    whyRelevant: "Der Ort kann insbesondere Dienstreisen oder Lehrgänge konkreter zuordnen.",
    usedFor: "Detailansicht, CSV und PDF.",
    inputGuidance: "Nenne Dienststätte, Lehrgangsort oder einen anderen knappen Ortsbezug.",
    commonMistakes: "Keine unnötigen privaten oder sicherheitsrelevanten Details eintragen.",
    requirementLevel: optional
  }),
  "unavailable.hasEvidence": help("unavailable.hasEvidence", {
    label: "Beleg vorhanden",
    shortHelp: "Kennzeichnet einen extern gespeicherten Nachweis zur Nichtverfügbarkeit.",
    whyRelevant: "Die Kennzeichnung erleichtert die spätere Dokumentationsprüfung.",
    usedFor: "Detailansicht und Nachvollziehbarkeit.",
    inputGuidance: "Aktiviere sie nur bei tatsächlich vorhandener externer Unterlage.",
    commonMistakes: "Die App lädt durch das Aktivieren keine Datei hoch.",
    requirementLevel: optional
  }),
  "unavailable.evidenceReference": help("unavailable.evidenceReference", {
    label: "Belegreferenz",
    shortHelp: "Eindeutiger Dateiname oder Ablagehinweis für den externen Nachweis.",
    whyRelevant: "Insbesondere dienstliche Angaben bleiben dadurch später auffindbar.",
    usedFor: "CSV, PDF und Dokumentationsprüfung.",
    inputGuidance: "Bei dienstlicher Veranlassung wird eine konkrete Referenz empfohlen.",
    commonMistakes: "Nicht nur „Dienstplan“ schreiben, sondern Monat oder Dateinamen ergänzen.",
    requirementLevel: recommended,
    examples: "Dienstplan_06-2026.pdf",
    relatedReportSection: "Dienstlich bedingte Nichtverfügbarkeit"
  }),
  "unavailable.notes": help("unavailable.notes", {
    label: "Notiz",
    shortHelp: "Sachliche Ergänzung zur Nichtverfügbarkeit.",
    whyRelevant: "Eine Notiz kann Kategorie und Auswirkungen erläutern.",
    usedFor: "Detailansicht, CSV und PDF.",
    inputGuidance: "Bei „Sonstiges“ den konkreten Grund knapp erläutern.",
    commonMistakes: "Keine rechtlichen Bewertungen oder Vorwürfe eintragen.",
    requirementLevel: recommended,
    relatedReportSection: "Dienstlich bedingte Nichtverfügbarkeit"
  }),

  "monthClosure.close": help("monthClosure.close", {
    label: "Monat abschließen",
    shortHelp: "Markiert einen geprüften Monatsdatenstand als abgeschlossen.",
    whyRelevant: "Spätere Änderungen werden dadurch besonders nachvollziehbar.",
    usedFor: "Monatszusammenfassung, Berichtssperre und Änderungsprotokoll.",
    inputGuidance: "Schließe erst ab, nachdem offene Termine und Warnungen geprüft wurden.",
    commonMistakes: "Einen Monat nicht mit ungeprüften geplanten Terminen abschließen.",
    requirementLevel: required
  }),
  "monthClosure.openAppointments": help("monthClosure.openAppointments", {
    label: "Offene Termine",
    shortHelp: "Geplante Termine in der Vergangenheit ohne abschließenden Status.",
    whyRelevant: "Sie können den Soll-Ist-Vergleich und die Vollständigkeit verzerren.",
    usedFor: "Datenqualität und Abschlussprüfung.",
    inputGuidance: "Prüfe jeden Termin und setze ihn auf durchgeführt oder ausgefallen.",
    commonMistakes: "Vergangene Termine nicht dauerhaft auf geplant belassen.",
    requirementLevel: required
  }),
  "monthClosure.warnings": help("monthClosure.warnings", {
    label: "Abschlusswarnungen",
    shortHelp: "Hinweise auf unvollständige oder widersprüchliche Monatsdaten.",
    whyRelevant: "Warnungen helfen, den Datenstand vor dem Abschluss zu prüfen.",
    usedFor: "Monatsabschluss und Datenqualität.",
    inputGuidance: "Öffne die betroffenen Einträge und korrigiere bekannte Lücken.",
    commonMistakes: "Warnungen nicht ungeprüft bestätigen.",
    requirementLevel: required
  }),
  "monthClosure.changeAfterClose": help("monthClosure.changeAfterClose", {
    label: "Änderung nach Abschluss",
    shortHelp: "Änderungen an bereits abgeschlossenen Monatsdaten.",
    whyRelevant: "Der Abschluss bleibt erhalten, die spätere Änderung wird aber sichtbar protokolliert.",
    usedFor: "Berichtsdatenstand und Audit Log.",
    inputGuidance: "Ändere abgeschlossene Daten nur nach Prüfung des Warnhinweises.",
    commonMistakes: "Nachträgliche Änderungen nicht durch Löschen und Neuanlegen verschleiern.",
    requirementLevel: required
  }),
  "monthClosure.dataQuality": help("monthClosure.dataQuality", {
    label: "Datenqualität",
    shortHelp: "Anzahl erkannter Lücken und offener Statusangaben.",
    whyRelevant: "Die Kennzahl unterstützt eine konsistente Dokumentation.",
    usedFor: "Dashboard und Monatsabschluss.",
    inputGuidance: "Prüfe die einzelnen Hinweise; die Kennzahl ist keine rechtliche Bewertung.",
    commonMistakes: "Null Hinweise nicht mit inhaltlicher Richtigkeit aller Angaben gleichsetzen.",
    requirementLevel: recommended
  }),
  "monthClosure.note": help("monthClosure.note", {
    label: "Abschlussnotiz",
    shortHelp: "Optionale sachliche Notiz zum geprüften Monatsstand.",
    whyRelevant: "Sie kann bekannte Besonderheiten des Abschlusses dokumentieren.",
    usedFor: "Monatsabschluss und Änderungsnachweis.",
    inputGuidance: "Nur konkrete, für den Abschluss relevante Hinweise notieren.",
    commonMistakes: "Keine Bewertungen anderer Personen eintragen.",
    requirementLevel: optional
  }),

  "analytics.startDate": help("analytics.startDate", {
    label: "Zeitraum von",
    shortHelp: "Erster Tag der Auswertung.",
    whyRelevant: "Nur Daten ab diesem Tag werden berücksichtigt.",
    usedFor: "Kennzahlen, Tabellen, CSV und PDF.",
    inputGuidance: "Wähle den sachlich gewünschten Beginn.",
    commonMistakes: "Nicht versehentlich einen späteren Beginn als das Ende wählen.",
    requirementLevel: required
  }),
  "analytics.endDate": help("analytics.endDate", {
    label: "Zeitraum bis",
    shortHelp: "Letzter Tag der Auswertung.",
    whyRelevant: "Nur Daten bis einschließlich dieses Tages werden berücksichtigt.",
    usedFor: "Kennzahlen, Tabellen, CSV und PDF.",
    inputGuidance: "Wähle das sachlich gewünschte Ende.",
    commonMistakes: "Das Ende darf nicht vor dem Beginn liegen.",
    requirementLevel: required
  }),
  "analytics.month": help("analytics.month", {
    label: "Monat",
    shortHelp: "Wählt einen vollständigen Kalendermonat aus.",
    whyRelevant: "Monatswerte bleiben dadurch untereinander vergleichbar.",
    usedFor: "Monatsauswertung und Abschluss.",
    inputGuidance: "Wähle Jahr und Monat.",
    commonMistakes: "Nicht mit einem frei gewählten 30-Tage-Zeitraum verwechseln.",
    requirementLevel: optional
  }),
  "analytics.quarter": help("analytics.quarter", {
    label: "Quartal",
    shortHelp: "Wählt drei zusammengehörige Kalendermonate aus.",
    whyRelevant: "Quartale ermöglichen standardisierte Zeitvergleiche.",
    usedFor: "Quartalsauswertung.",
    inputGuidance: "Wähle Q1 bis Q4 und das Jahr.",
    commonMistakes: "Keine frei verschobenen Dreimonatszeiträume als Quartal verstehen.",
    requirementLevel: optional
  }),
  "analytics.year": help("analytics.year", {
    label: "Kalenderjahr",
    shortHelp: "Wählt den Zeitraum vom 1. Januar bis 31. Dezember.",
    whyRelevant: "Jahressummen werden einheitlich abgegrenzt.",
    usedFor: "Jahresauswertung, Kosten und Fahrten.",
    inputGuidance: "Wähle das gewünschte Kalenderjahr.",
    commonMistakes: "Nicht mit zwölf Monaten ab einem beliebigen Starttag verwechseln.",
    requirementLevel: optional
  }),
  "analytics.children": help("analytics.children", {
    label: "Kinderauswahl",
    shortHelp: "Begrenzt die Auswertung auf ein Kind oder zeigt alle gemeinsam.",
    whyRelevant: "Kennzahlen können je Kind unterschiedlich sein.",
    usedFor: "Kindbezogene und gemeinsame Auswertungen.",
    inputGuidance: "Prüfe vor dem Export, ob die gewünschte Auswahl aktiv ist.",
    commonMistakes: "Gemeinsame Werte nicht als Wert eines einzelnen Kindes lesen.",
    requirementLevel: optional
  }),
  "analytics.careDayQuote": help("analytics.careDayQuote", {
    label: "Betreuungsquote nach Kalendertagen",
    shortHelp: "Anteil dokumentierter tatsächlicher Betreuungstage am gewählten Zeitraum.",
    whyRelevant: "Die Quote zeigt Kalendertage, nicht automatisch volle 24-Stunden-Betreuung.",
    usedFor: "Auswertung und PDF.",
    inputGuidance: "Im Zusammenhang mit Dauer und Betreuungsumfang lesen.",
    commonMistakes: "Stundenweise Kontakte nicht als ganztägige Betreuung interpretieren.",
    requirementLevel: optional
  }),
  "analytics.overnightQuote": help("analytics.overnightQuote", {
    label: "Betreuungsquote nach Übernachtungen",
    shortHelp: "Anteil dokumentierter Übernachtungen am gewählten Zeitraum.",
    whyRelevant: "Übernachtungen werden getrennt von Betreuungstagen ausgewiesen.",
    usedFor: "Auswertung und PDF.",
    inputGuidance: "Nur tatsächlich markierte Übernachtungen fließen ein.",
    commonMistakes: "Abend- oder Tagesbetreuung nicht als Übernachtung lesen.",
    requirementLevel: optional
  }),
  "analytics.additionalCare": help("analytics.additionalCare", {
    label: "Zusatzbetreuung",
    shortHelp: "Anzahl tatsächlich durchgeführter zusätzlicher Termine.",
    whyRelevant: "Zusätzliche Betreuung bleibt von Regelterminen getrennt.",
    usedFor: "Auswertung und PDF.",
    inputGuidance: "Die Kennzahl zusammen mit der Regeltermin-Auswertung betrachten.",
    commonMistakes: "Regeltermine nicht doppelt als Zusatzbetreuung zählen.",
    requirementLevel: optional
  }),
  "analytics.hourlyCare": help("analytics.hourlyCare", {
    label: "Stundenweise Betreuung",
    shortHelp: "Kurze Betreuung wird zeitlich gesondert ausgewiesen.",
    whyRelevant: "Sie darf nicht ohne Weiteres als voller Betreuungstag erscheinen.",
    usedFor: "Detailauswertung und Bericht.",
    inputGuidance: "Beginn, Ende und Betreuungsumfang gemeinsam prüfen.",
    commonMistakes: "Kurze Kontakte nicht künstlich aufwerten.",
    requirementLevel: optional
  }),
  "analytics.costs": help("analytics.costs", {
    label: "Kosten",
    shortHelp: "Summe konkret erfasster Kosten im gewählten Zeitraum.",
    whyRelevant: "Die Summe basiert ausschließlich auf dokumentierten Einzelposten.",
    usedFor: "Monats-, Jahres-, CSV- und PDF-Auswertung.",
    inputGuidance: "Detailposten und Zeitraum vor der Interpretation prüfen.",
    commonMistakes: "Rechnerische Fahrtkosten und separat erfasste Kosten nicht ungeprüft addieren.",
    requirementLevel: optional
  }),
  "analytics.trips": help("analytics.trips", {
    label: "Fahrten",
    shortHelp: "Summe dokumentierter Kilometer und rechnerischer Fahrtkosten.",
    whyRelevant: "Die Kennzahl macht betreuungsbezogene Fahrten sichtbar.",
    usedFor: "Zeitraumauswertung, CSV und PDF.",
    inputGuidance: "Kilometerzahl und eingestellten Kilometersatz beachten.",
    commonMistakes: "Rechnerische Fahrtkosten nicht mit einer tatsächlichen Zahlung gleichsetzen.",
    requirementLevel: optional
  }),

  "export.jsonExport": help("export.jsonExport", {
    label: "JSON-Backup exportieren",
    shortHelp: "Speichert den vollständigen lokalen Datenbestand als Sicherungsdatei.",
    whyRelevant: "Die Datei ermöglicht eine spätere Wiederherstellung.",
    usedFor: "Backup und Wiederherstellung.",
    inputGuidance: "Exportiere regelmäßig und bewahre die Datei an einem geschützten Ort auf.",
    commonMistakes: "Ein Browser-Download ist erst dann eine Sicherung, wenn die Datei auffindbar gespeichert wurde.",
    requirementLevel: recommended
  }),
  "export.jsonImport": help("export.jsonImport", {
    label: "JSON-Backup importieren",
    shortHelp: "Ersetzt den aktuellen SQLite-Datenstand durch eine zuvor exportierte Sicherung.",
    whyRelevant: "Der Import dient der Wiederherstellung oder Übertragung.",
    usedFor: "Wiederherstellung.",
    inputGuidance: "Erstelle vor dem Import ein aktuelles Backup und prüfe Dateiname sowie Datum.",
    commonMistakes: "Nicht versehentlich eine ältere Sicherung über neuere Daten importieren.",
    requirementLevel: optional
  }),
  "export.csvExport": help("export.csvExport", {
    label: "CSV exportieren",
    shortHelp: "Exportiert strukturierte Rohdaten für Tabellenprogramme.",
    whyRelevant: "CSV erleichtert externe Prüfung und eigene Auswertungen.",
    usedFor: "Betreuungseinträge, Fahrten, Kosten, Ferien und Nichtverfügbarkeiten.",
    inputGuidance: "Wähle den passenden getrennten Export und prüfe die Datei nach dem Download.",
    commonMistakes: "CSV ist kein vollständiges Backup der App-Einstellungen und Historie.",
    requirementLevel: optional
  }),
  "export.pdfReport": help("export.pdfReport", {
    label: "PDF-Bericht",
    shortHelp: "Erzeugt einen sachlichen Bericht für den gewählten Zeitraum.",
    whyRelevant: "Das PDF fasst dokumentierte Daten nachvollziehbar zusammen.",
    usedFor: "Bericht und Druckansicht.",
    inputGuidance: "Prüfe Zeitraum, Kinder, Datenstand und offene Monate vor der Erstellung.",
    commonMistakes: "Der Bericht enthält keine rechtliche Bewertung und ersetzt keine Prüfung der Eingaben.",
    requirementLevel: optional
  }),
  "export.includeAudit": help("export.includeAudit", {
    label: "Änderungshistorie einschließen",
    shortHelp: "Nimmt relevante Audit-Log-Einträge in den PDF-Bericht auf.",
    whyRelevant: "Änderungen am dokumentierten Datenstand werden sichtbar.",
    usedFor: "PDF-Abschnitt Änderungshistorie.",
    inputGuidance: "Aktiviere die Option, wenn Entstehung und spätere Änderungen mit ausgegeben werden sollen.",
    commonMistakes: "Die Historie kann den Bericht deutlich verlängern.",
    requirementLevel: optional,
    relatedReportSection: "Änderungshistorie"
  }),
  "export.startDate": help("export.startDate", {
    label: "Berichtszeitraum von",
    shortHelp: "Erster Tag des Exports oder Berichts.",
    whyRelevant: "Der Zeitraum bestimmt, welche Daten enthalten sind.",
    usedFor: "CSV und PDF.",
    inputGuidance: "Wähle den beabsichtigten ersten Tag.",
    commonMistakes: "Nicht versehentlich relevante Vortage ausschließen.",
    requirementLevel: required
  }),
  "export.endDate": help("export.endDate", {
    label: "Berichtszeitraum bis",
    shortHelp: "Letzter eingeschlossener Tag des Exports oder Berichts.",
    whyRelevant: "Der Zeitraum bestimmt, welche Daten enthalten sind.",
    usedFor: "CSV und PDF.",
    inputGuidance: "Wähle den beabsichtigten letzten Tag.",
    commonMistakes: "Das Ende darf nicht vor dem Beginn liegen.",
    requirementLevel: required
  }),
  "export.reportId": help("export.reportId", {
    label: "Berichts-ID",
    shortHelp: "Eindeutige technische Kennung eines erzeugten Berichts.",
    whyRelevant: "Sie unterscheidet verschiedene Berichtserstellungen.",
    usedFor: "PDF-Kopf und Nachvollziehbarkeit.",
    inputGuidance: "Die ID wird automatisch erzeugt und muss nicht manuell geändert werden.",
    commonMistakes: "Gleiche Zeiträume können unterschiedliche IDs haben, wenn Berichte erneut erzeugt werden.",
    requirementLevel: optional
  }),
  "export.dataState": help("export.dataState", {
    label: "Datenstand",
    shortHelp: "Zeitpunkt und Abschlussstatus der im Bericht enthaltenen Daten.",
    whyRelevant: "Der Datenstand zeigt, ob spätere Änderungen möglich oder bereits erfolgt sind.",
    usedFor: "PDF-Kopf und Berichtssperre.",
    inputGuidance: "Prüfe, ob offene oder abgeschlossene Monate enthalten sind.",
    commonMistakes: "Erstellungsdatum des Berichts nicht mit Datum der letzten Dateneingabe verwechseln.",
    requirementLevel: recommended
  }),

  "settings.kilometerRate": help("settings.kilometerRate", {
    label: "Kilometersatz",
    shortHelp: "Rechnerischer Betrag pro gefahrenem Kilometer.",
    whyRelevant: "Der Satz wird mit dokumentierten Kilometern multipliziert.",
    usedFor: "Rechnerische Fahrtkosten in Auswertung und PDF.",
    inputGuidance: "Trage den gewünschten Rechensatz in Euro pro Kilometer ein.",
    commonMistakes: "Der Rechenwert ist kein Nachweis einer tatsächlichen Zahlung oder Erstattung.",
    requirementLevel: required,
    examples: "0,30 €/km"
  }),
  "settings.defaultLocation": help("settings.defaultLocation", {
    label: "Standard-Betreuungsort",
    shortHelp: "Vorauswahl für neue Betreuungseinträge.",
    whyRelevant: "Die Einstellung beschleunigt die Erfassung häufiger Abläufe.",
    usedFor: "Neue Betreuungseinträge.",
    inputGuidance: "Wähle den am häufigsten passenden Ort und korrigiere ihn im Einzelfall.",
    commonMistakes: "Die Vorauswahl nicht ungeprüft übernehmen, wenn der tatsächliche Ort abweicht.",
    requirementLevel: required
  }),
  "settings.defaultHandoverFrom": help("settings.defaultHandoverFrom", {
    label: "Standard-Übergabe von",
    shortHelp: "Vorauswahl für den Beginn neuer Betreuungseinträge.",
    whyRelevant: "Sie reduziert wiederholte Eingaben.",
    usedFor: "Neue Betreuungseinträge.",
    inputGuidance: "Wähle den häufigsten Ablauf und korrigiere Abweichungen im Eintrag.",
    commonMistakes: "Standardwert nicht mit tatsächlich erfolgter Übergabe verwechseln.",
    requirementLevel: required
  }),
  "settings.defaultHandoverTo": help("settings.defaultHandoverTo", {
    label: "Standard-Übergabe an",
    shortHelp: "Vorauswahl für das Ende neuer Betreuungseinträge.",
    whyRelevant: "Sie reduziert wiederholte Eingaben.",
    usedFor: "Neue Betreuungseinträge.",
    inputGuidance: "Wähle den häufigsten Ablauf und korrigiere Abweichungen im Eintrag.",
    commonMistakes: "Standardwert nicht ungeprüft übernehmen.",
    requirementLevel: required
  }),
  "settings.backup": help("settings.backup", {
    label: "Backup-Pfad und Hinweis",
    shortHelp: "Erinnert an die externe Ablage der heruntergeladenen JSON-Sicherung.",
    whyRelevant: "Die laufende SQLite-Datenbank allein ist keine dauerhafte Sicherungsstrategie.",
    usedFor: "Backup-Erinnerung und Wiederherstellung.",
    inputGuidance: "Lege Backups regelmäßig in einem geschützten, wiederauffindbaren Ordner ab.",
    commonMistakes: "Die App kann den tatsächlichen Speicherort im iOS-Dateisystem nicht zuverlässig erkennen.",
    requirementLevel: recommended
  }),
  "settings.pwaOffline": help("settings.pwaOffline", {
    label: "PWA- und Offline-Hinweis",
    shortHelp: "Beschreibt die Verfügbarkeit der Oberfläche ohne Netzwerk.",
    whyRelevant: "Offline verfügbare Oberfläche und sichere Datenspeicherung sind unterschiedliche Dinge.",
    usedFor: "Betriebsstatus.",
    inputGuidance: "Achte auf sichtbare Verbindungswarnungen und sichere Daten erst nach bestätigter Speicherung.",
    commonMistakes: "Keine erfolgreiche Serverspeicherung annehmen, wenn die Verbindung fehlt.",
    requirementLevel: recommended
  }),
  "settings.serverStatus": help("settings.serverStatus", {
    label: "Serverstatus",
    shortHelp: "Zeigt, ob der lokale Backend-Dienst erreichbar ist.",
    whyRelevant: "Bei Serverbetrieb darf eine fehlende Verbindung nicht als erfolgreiche Speicherung erscheinen.",
    usedFor: "Betriebsstatus und Fehlerhinweise.",
    inputGuidance: "Bei Offline-Anzeige keine unbestätigten Serveränderungen voraussetzen.",
    commonMistakes: "Eine geladene PWA-Oberfläche beweist nicht, dass der Server erreichbar ist.",
    requirementLevel: recommended
  }),
  "entries.search": help("entries.search", {
    label: "Einträge durchsuchen",
    shortHelp: "Filtert die sichtbare Liste nach Kind oder Notiz.",
    whyRelevant: "Die Suche erleichtert das Auffinden vorhandener Einträge.",
    usedFor: "Listenansicht.",
    inputGuidance: "Gib einen Namen oder einen sachlichen Begriff aus der Notiz ein.",
    commonMistakes: "Eine leere Trefferliste löscht oder verändert keine Daten.",
    requirementLevel: optional
  }),
  "audit.search": help("audit.search", {
    label: "Protokoll durchsuchen",
    shortHelp: "Filtert das Änderungsprotokoll nach Objekt, Feld oder Wert.",
    whyRelevant: "Die Suche erleichtert das Auffinden bestimmter Änderungen.",
    usedFor: "Änderungsprotokoll.",
    inputGuidance: "Suche nach einem sachlichen Begriff, Datumsteil oder Objektnamen.",
    commonMistakes: "Die Suche verändert keine Protokolleinträge.",
    requirementLevel: optional
  }),
  "audit.objectType": help("audit.objectType", {
    label: "Objektart",
    shortHelp: "Begrenzt das Änderungsprotokoll auf eine Datenart.",
    whyRelevant: "Der Filter trennt Änderungen an Betreuung, Fahrten, Kosten, Ferien und Nichtverfügbarkeiten.",
    usedFor: "Änderungsprotokoll.",
    inputGuidance: "Wähle „Alle“ oder die gesuchte Objektart.",
    commonMistakes: "Ein Filter blendet andere Protokolle nur aus und löscht sie nicht.",
    requirementLevel: optional
  })
} satisfies Record<string, FieldHelp>;

export type FieldHelpId = keyof typeof fieldHelpById;

export const allFieldHelp = Object.values(fieldHelpById);

export function getFieldHelp(fieldId: FieldHelpId): FieldHelp {
  return fieldHelpById[fieldId];
}

export const requirementLevelLabels: Record<RequirementLevel, string> = {
  required: "Pflichtfeld",
  recommended: "Empfohlen",
  optional: "Optional"
};
