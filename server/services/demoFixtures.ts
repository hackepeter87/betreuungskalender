import { appDataImportSchema } from "../validation/schemas.js";

type DemoData = ReturnType<typeof appDataImportSchema.parse>;

const timestamp = "2026-07-01T10:00:00.000Z";
const actor = "demo-fixture";

function entry(input: {
  id: string;
  startDateTime: string;
  endDateTime: string;
  childIds: string[];
  status: "planned" | "completed" | "cancelled";
  careScope: string;
  cancellationReason?: string;
  overnight?: boolean;
  schoolHandover?: boolean;
  holiday?: boolean;
  weekend?: boolean;
  additionalCare?: boolean;
  location?: string;
  customLocation?: string;
  handoverFrom?: string;
  handoverTo?: string;
  notes?: string;
  hasEvidence?: boolean;
  evidenceReference?: string;
  responsiblePartyId?: string;
  generatedByPatternId?: string;
  ruleOccurrenceDate?: string;
  trips?: Array<Record<string, unknown>>;
  costs?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    overnight: false,
    schoolHandover: false,
    holiday: false,
    weekend: false,
    additionalCare: false,
    location: "commuterApartment",
    handoverFrom: "mother",
    handoverTo: "father",
    hasEvidence: false,
    responsiblePartyId: "demo-party-primary",
    trips: [],
    costs: [],
    createdBy: actor,
    updatedBy: actor,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input
  };
}

export function createEdgeCaseDemoData(): DemoData {
  const children = [
    {
      id: "demo-child-alpha",
      name: "Demo Alpha",
      birthMonth: 2,
      birthYear: 2014,
      color: "#0d9488",
      createdBy: actor,
      updatedBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: "demo-child-beta",
      name: "Demo Beta",
      birthMonth: 11,
      birthYear: 2017,
      color: "#6967d9",
      createdBy: actor,
      updatedBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: "demo-child-gamma",
      name: "Demo Gamma",
      birthMonth: 7,
      birthYear: 2020,
      color: "#d97706",
      createdBy: actor,
      updatedBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
  const careParties = [
    {
      id: "demo-party-primary",
      name: "Hauptbetreuung",
      kind: "other",
      createdBy: actor,
      updatedBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: "demo-party-grandparent",
      name: "Großeltern",
      kind: "grandparent",
      createdBy: actor,
      updatedBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];

  const entries = [
    entry({
      id: "demo-entry-month-boundary-overnight",
      startDateTime: "2026-06-30T18:00:00.000Z",
      endDateTime: "2026-07-01T07:30:00.000Z",
      childIds: ["demo-child-alpha", "demo-child-beta"],
      status: "completed",
      careScope: "overnight",
      overnight: true,
      schoolHandover: true,
      location: "school",
      handoverFrom: "mother",
      handoverTo: "school",
      notes: "Fiktive Monatsgrenze mit Übernachtung und Schulübergabe.",
      hasEvidence: true,
      evidenceReference: "DEMO-BELEG-UEBERNACHTUNG",
      trips: [
        {
          id: "demo-trip-school-return",
          purpose: "school",
          km: 14.5,
          ownCar: true,
          reimbursed: true,
          reimbursementAmount: 4.35,
          notes: "Fiktive Fahrt zur Schule."
        }
      ],
      costs: [
        {
          id: "demo-cost-breakfast",
          category: "food",
          amount: 7.9,
          paidBy: "father",
          notes: "Fiktives Frühstück."
        }
      ]
    }),
    entry({
      id: "demo-entry-cancelled-with-reason",
      startDateTime: "2026-07-04T09:00:00.000Z",
      endDateTime: "2026-07-04T17:00:00.000Z",
      childIds: ["demo-child-alpha"],
      status: "cancelled",
      careScope: "half_day",
      cancellationReason: "Fiktiver Ausfall wegen Terminüberschneidung.",
      weekend: true,
      additionalCare: true,
      location: "mother",
      notes: "Ausfall mit Grund, damit Filter und Auswertungen den Status zeigen."
    }),
    entry({
      id: "demo-entry-generated-friday-weekend",
      generatedByPatternId: "demo-pattern-biweekly-weekend",
      ruleOccurrenceDate: "2026-07-10",
      startDateTime: "2026-07-10T15:30:00.000Z",
      endDateTime: "2026-07-12T16:00:00.000Z",
      childIds: ["demo-child-alpha", "demo-child-beta", "demo-child-gamma"],
      status: "planned",
      careScope: "overnight",
      overnight: true,
      weekend: true,
      location: "commuterApartment",
      handoverFrom: "school",
      handoverTo: "mother",
      notes: "Aus wiederkehrender Umgangsregel generierter Wochenendtermin."
    }),
    entry({
      id: "demo-entry-short-contact",
      startDateTime: "2026-07-15T16:00:00.000Z",
      endDateTime: "2026-07-15T17:15:00.000Z",
      childIds: ["demo-child-gamma"],
      status: "completed",
      careScope: "visit_contact",
      location: "other",
      customLocation: "Fiktiver Spielplatz Nord",
      handoverFrom: "thirdParty",
      handoverTo: "mother",
      notes: "Kurzer Kontakt unter zwei Stunden für Kontaktzeit-Grenzfälle.",
      trips: [
        {
          id: "demo-trip-leisure",
          purpose: "leisure",
          km: 3.2,
          ownCar: false,
          reimbursed: false,
          notes: "Fiktive ÖPNV-Strecke."
        }
      ]
    }),
    entry({
      id: "demo-entry-holiday-full-day",
      startDateTime: "2026-07-21T08:00:00.000Z",
      endDateTime: "2026-07-21T20:00:00.000Z",
      childIds: ["demo-child-beta"],
      status: "completed",
      careScope: "full_day",
      holiday: true,
      additionalCare: true,
      responsiblePartyId: "demo-party-grandparent",
      location: "mainResidence",
      handoverFrom: "mother",
      handoverTo: "mother",
      notes: "Ganztägige Ferienbetreuung mit Zusatzbetreuung.",
      costs: [
        {
          id: "demo-cost-leisure",
          category: "leisure",
          amount: 18.5,
          paidBy: "both",
          notes: "Fiktiver Eintritt."
        },
        {
          id: "demo-cost-travel",
          category: "travel",
          amount: 6.4,
          paidBy: "father",
          notes: "Fiktive Fahrtkosten."
        }
      ]
    }),
    entry({
      id: "demo-entry-future-overdue-candidate",
      startDateTime: "2026-07-02T15:00:00.000Z",
      endDateTime: "2026-07-02T18:00:00.000Z",
      childIds: ["demo-child-alpha"],
      status: "planned",
      careScope: "hourly",
      location: "ogs",
      handoverFrom: "ogs",
      handoverTo: "mother",
      notes: "Geplanter Termin nahe Monatsanfang für Dashboard- und Qualitätszustände."
    })
  ];

  const data = {
    schemaVersion: 6,
    children,
    careParties,
    entries,
    holidayPeriods: [
      {
        id: "demo-holiday-shared-summer",
        name: "Fiktive Sommerferien geteilt",
        startDate: "2026-07-20",
        endDate: "2026-08-02",
        childIds: ["demo-child-alpha", "demo-child-beta"],
        assignedTo: "shared",
        notes: "Ferienzeitraum über Monatsgrenze.",
        createdBy: actor,
        updatedBy: actor,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "demo-holiday-mother-single",
        name: "Fiktiver Mutter-Urlaub",
        startDate: "2026-07-06",
        endDate: "2026-07-10",
        childIds: ["demo-child-gamma"],
        assignedTo: "mother",
        notes: "Einzelkind-Ferienfall.",
        createdBy: actor,
        updatedBy: actor,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    unavailablePeriods: [
      {
        id: "demo-unavailable-duty-contact",
        startDateTime: "2026-07-10T06:00:00.000Z",
        endDateTime: "2026-07-10T14:00:00.000Z",
        category: "duty",
        dutyRelated: true,
        affectsContact: true,
        affectsHolidays: false,
        location: "Fiktive Dienststelle",
        notes: "Dienstliche Nichtverfügbarkeit direkt vor Umgangsbeginn.",
        hasEvidence: true,
        evidenceReference: "DEMO-DIENSTPLAN-001",
        createdBy: actor,
        updatedBy: actor,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "demo-unavailable-other-warning",
        startDateTime: "2026-07-18T09:00:00.000Z",
        endDateTime: "2026-07-18T11:00:00.000Z",
        category: "other",
        dutyRelated: false,
        affectsContact: true,
        affectsHolidays: true,
        hasEvidence: false,
        createdBy: actor,
        updatedBy: actor,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    externalCalendarSources: [
      {
        id: "demo-external-school",
        name: "Fiktiver Schulkalender",
        color: "#2563eb",
        visible: true,
        lastImportedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    externalCalendarEvents: [
      {
        id: "demo-external-school-fest",
        sourceId: "demo-external-school",
        icalUid: "demo-school-fest-synthetic",
        recurrenceId: "",
        title: "Fiktives Schulfest",
        description: "Ganztägiger externer Kalendereintrag.",
        startDateTime: "2026-07-03T00:00:00.000Z",
        endDateTime: "2026-07-04T00:00:00.000Z",
        allDay: true,
        location: "Fiktive Schule",
        rawHash: "demo-school-fest",
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "demo-external-appointment",
        sourceId: "demo-external-school",
        icalUid: "demo-appointment-synthetic",
        recurrenceId: "20260715T150000Z",
        title: "Fiktiver Elterntermin",
        description: "Zeitgebundener externer Termin mit Recurrence-ID.",
        startDateTime: "2026-07-15T15:00:00.000Z",
        endDateTime: "2026-07-15T15:45:00.000Z",
        allDay: false,
        location: "Fiktiver Besprechungsraum",
        rawHash: "demo-appointment",
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    contactPatterns: [
      {
        id: "demo-pattern-biweekly-weekend",
        name: "Alle 14 Tage Freitag bis Sonntag",
        startDate: "2026-07-10",
        frequency: "biweekly",
        fridayStartTime: "15:30",
        sundayEndTime: "16:00",
        childIds: ["demo-child-alpha", "demo-child-beta", "demo-child-gamma"],
        active: true,
        createdBy: actor,
        updatedBy: actor,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "demo-pattern-inactive",
        name: "Inaktive Altregel",
        startDate: "2026-07-24",
        frequency: "biweekly",
        fridayStartTime: "17:00",
        sundayEndTime: "18:00",
        childIds: ["demo-child-alpha"],
        active: false,
        createdBy: actor,
        updatedBy: actor,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    auditLog: [
      {
        id: "demo-audit-entry-updated",
        timestamp: "2026-07-01T11:00:00.000Z",
        userId: actor,
        objectType: "careEntry",
        objectId: "demo-entry-month-boundary-overnight",
        objectLabel: "Monatsgrenze Übernachtung",
        field: "notes",
        oldValue: "Fiktiver Erstwert",
        newValue: "Fiktive Monatsgrenze mit Übernachtung und Schulübergabe.",
        action: "updated"
      }
    ],
    monthClosures: [
      {
        monthKey: "2026-06",
        closedAt: "2026-06-30T21:00:00.000Z",
        closedBy: actor,
        updatedBy: actor,
        changedAfterCloseAt: "2026-07-01T11:00:00.000Z",
        dataUpdatedAt: timestamp,
        summary: {
          entryCount: 1,
          careDays: 1,
          overnights: 1,
          weekends: 0,
          completedEntries: 1,
          plannedEntries: 0,
          cancelledEntries: 0,
          completeness: 1,
          dataQuality: {
            incompleteEntries: 0,
            cancellationsWithoutReason: 0,
            tripsWithoutPurpose: 0,
            costsWithoutCategory: 0,
            overduePlannedEntries: 0,
            totalIssues: 0
          },
          warnings: ["Fiktiver nachträglicher Änderungsfall."]
        }
      }
    ],
    lastJsonBackupAt: "2026-07-01T09:30:00.000Z",
    settings: {
      kilometerRate: 0.3,
      defaultLocation: "commuterApartment",
      defaultHandoverFrom: "mother",
      defaultHandoverTo: "mother",
      rhythmStartDate: "2026-07-10"
    },
    updatedAt: timestamp
  };

  return appDataImportSchema.parse(data);
}

export function edgeCaseDemoSummary(data: DemoData) {
  return {
    dataset: "edge-cases",
    children: data.children.length,
    careParties: data.careParties.length,
    entries: data.entries.length,
    holidayPeriods: data.holidayPeriods.length,
    unavailablePeriods: data.unavailablePeriods.length,
    externalCalendarSources: data.externalCalendarSources.length,
    externalCalendarEvents: data.externalCalendarEvents.length,
    contactPatterns: data.contactPatterns.length,
    monthClosures: data.monthClosures.length,
    auditLog: data.auditLog.length
  };
}
