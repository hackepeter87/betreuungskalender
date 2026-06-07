import type {
  CareLocation,
  CostCategory,
  EntryStatus,
  HandoverParty,
  PaidBy,
  TripPurpose,
  UnavailableCategory
} from "../types";

export const statusLabels: Record<EntryStatus, string> = {
  completed: "Durchgeführt",
  planned: "Geplant",
  cancelled: "Ausgefallen"
};

export const locationLabels: Record<CareLocation, string> = {
  commuterApartment: "Pendlerwohnung",
  mainResidence: "Hauptwohnsitz",
  mother: "Bei der Mutter",
  school: "Schule",
  ogs: "OGS",
  other: "Anderer Ort"
};

export const handoverLabels: Record<HandoverParty, string> = {
  mother: "Mutter",
  father: "Vater",
  school: "Schule",
  ogs: "OGS",
  thirdParty: "Dritte"
};

export const tripPurposeLabels: Record<TripPurpose, string> = {
  pickup: "Abholung",
  return: "Rückbringung",
  school: "Schule",
  doctor: "Arzt",
  leisure: "Freizeit",
  workplace: "Dienststätte",
  other: "Sonstiges"
};

export const costCategoryLabels: Record<CostCategory, string> = {
  food: "Verpflegung",
  leisure: "Freizeit",
  school: "Schule",
  clothing: "Kleidung",
  travel: "Fahrtkosten",
  other: "Sonstiges"
};

export const paidByLabels: Record<PaidBy, string> = {
  father: "Vater",
  mother: "Mutter",
  both: "Beide",
  thirdParty: "Dritte"
};

export const holidayAssignmentLabels = {
  father: "Vater",
  mother: "Mutter",
  shared: "Hälftig / geteilt"
} as const;

export const unavailableCategoryLabels: Record<UnavailableCategory, string> = {
  duty: "Dienst",
  training_course: "Lehrgang",
  exercise: "Übung",
  guard_duty: "Wachdienst",
  standby: "Bereitschaft",
  deployment: "Einsatz",
  business_trip: "Dienstreise",
  illness: "Krankheit",
  private_unavailability: "Private Nichtverfügbarkeit",
  vacation_without_children: "Urlaub ohne Kinder",
  other: "Sonstiges"
};
