import type { AppData, CareEntry, CareParty, Child } from "../types";
import { SCHEMA_VERSION } from "../types";
import { makeId, nowIso, toDateKey } from "../lib/date";

export const CHILD_COLORS = ["#0d9488", "#6967d9", "#d97706", "#2563eb", "#c24170"];

export function createEmptyData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    children: [],
    careParties: [],
    entries: [],
    holidayPeriods: [],
    unavailablePeriods: [],
    externalCalendarSources: [],
    externalCalendarEvents: [],
    contactPatterns: [],
    contactRules: [],
    auditLog: [],
    monthClosures: [],
    settings: {
      kilometerRate: 0.3,
      defaultLocation: "commuterApartment",
      defaultHandoverFrom: "mother",
      defaultHandoverTo: "mother"
    },
    updatedAt: nowIso()
  };
}

function demoDate(dayOffset: number, hour: number, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

export function createDemoData(): AppData {
  const timestamp = nowIso();
  const children: Child[] = [
    {
      id: makeId("child"),
      name: "Demo-Kind A",
      birthMonth: 5,
      birthYear: 2015,
      color: CHILD_COLORS[0],
      createdBy: "local-dev",
      updatedBy: "local-dev",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: makeId("child"),
      name: "Demo-Kind B",
      birthMonth: 5,
      birthYear: 2017,
      color: CHILD_COLORS[1],
      createdBy: "local-dev",
      updatedBy: "local-dev",
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
  const careParties: CareParty[] = [
    {
      id: makeId("party"),
      name: "Hauptbetreuung",
      kind: "other",
      createdBy: "local-dev",
      updatedBy: "local-dev",
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];

  const makeEntry = (
    dayOffset: number,
    childIds: string[],
    status: CareEntry["status"],
    overnight: boolean,
    note: string
  ): CareEntry => {
    const start = demoDate(dayOffset, 16);
    const end = demoDate(dayOffset + (overnight ? 1 : 0), overnight ? 7 : 20, 30);
    return {
      id: makeId("entry"),
      date: toDateKey(start),
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      childIds,
      responsiblePartyId: careParties[0]?.id,
      status,
      additionalCare: false,
      overnight,
      schoolHandover: overnight,
      holiday: false,
      weekend: start.getDay() === 0 || start.getDay() === 6,
      location: "commuterApartment",
      handoverFrom: "school",
      handoverTo: overnight ? "school" : "mother",
      notes: note,
      hasEvidence: false,
      trips: [],
      costs: [],
      createdBy: "local-dev",
      updatedBy: "local-dev",
      createdAt: timestamp,
      updatedAt: timestamp
    };
  };

  return {
    ...createEmptyData(),
    children,
    careParties,
    entries: [
      makeEntry(-8, children.map((child) => child.id), "completed", true, "Reguläre Betreuung"),
      makeEntry(-3, [children[0].id], "completed", false, "Abholung nach der Schule"),
      makeEntry(1, children.map((child) => child.id), "planned", true, "Geplanter Umgang"),
      makeEntry(5, [children[1].id], "planned", false, "Zusätzlicher Nachmittag")
    ],
    contactPatterns: [],
    contactRules: [],
    holidayPeriods: [],
    unavailablePeriods: [],
    updatedAt: timestamp
  };
}
