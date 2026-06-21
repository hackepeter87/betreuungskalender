import type {
  CareLocation,
  CostCategory,
  EntryStatus,
  HandoverParty,
  PaidBy,
  TripPurpose,
  UnavailableCategory
} from "../types";
import type { AppLocale } from "../i18n/resources";

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

const localizedLabels = {
  de: {
    status: statusLabels,
    costCategory: costCategoryLabels,
    unavailableCategory: unavailableCategoryLabels
  },
  en: {
    status: {
      completed: "Completed",
      planned: "Planned",
      cancelled: "Cancelled"
    },
    costCategory: {
      food: "Food",
      leisure: "Leisure",
      school: "School",
      clothing: "Clothing",
      travel: "Travel costs",
      other: "Other"
    },
    unavailableCategory: {
      duty: "Duty",
      training_course: "Training course",
      exercise: "Exercise",
      guard_duty: "Guard duty",
      standby: "Standby",
      deployment: "Deployment",
      business_trip: "Business trip",
      illness: "Illness",
      private_unavailability: "Private unavailability",
      vacation_without_children: "Holiday without children",
      other: "Other"
    }
  }
} satisfies Record<
  AppLocale,
  {
    status: Record<EntryStatus, string>;
    costCategory: Record<CostCategory, string>;
    unavailableCategory: Record<UnavailableCategory, string>;
  }
>;

export function statusLabel(status: EntryStatus, locale: AppLocale): string {
  return localizedLabels[locale].status[status];
}

export function costCategoryLabel(
  category: CostCategory,
  locale: AppLocale
): string {
  return localizedLabels[locale].costCategory[category];
}

export function unavailableCategoryLabel(
  category: UnavailableCategory,
  locale: AppLocale
): string {
  return localizedLabels[locale].unavailableCategory[category];
}
