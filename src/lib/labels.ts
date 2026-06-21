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
import { catalog } from "../i18n/catalog";

export const statusLabels: Record<EntryStatus, string> = {
  completed: catalog.de.labels.completed,
  planned: catalog.de.labels.planned,
  cancelled: catalog.de.labels.cancelled
};

export const locationLabels: Record<CareLocation, string> = {
  commuterApartment: catalog.de.labels.commuterApartment,
  mainResidence: catalog.de.labels.mainResidence,
  mother: catalog.de.labels.locationMother,
  school: catalog.de.labels.school,
  ogs: catalog.de.labels.ogs,
  other: catalog.de.labels.otherLocation
};

export const handoverLabels: Record<HandoverParty, string> = {
  mother: catalog.de.labels.mother,
  father: catalog.de.labels.father,
  school: catalog.de.labels.school,
  ogs: catalog.de.labels.ogs,
  thirdParty: catalog.de.labels.thirdParty
};

export const tripPurposeLabels: Record<TripPurpose, string> = {
  pickup: catalog.de.labels.pickup,
  return: catalog.de.labels.return,
  school: catalog.de.labels.school,
  doctor: catalog.de.labels.doctor,
  leisure: catalog.de.labels.leisure,
  workplace: catalog.de.labels.workplace,
  other: catalog.de.labels.other
};

export const costCategoryLabels: Record<CostCategory, string> = {
  food: catalog.de.labels.food,
  leisure: catalog.de.labels.leisure,
  school: catalog.de.labels.school,
  clothing: catalog.de.labels.clothing,
  travel: catalog.de.labels.travel,
  other: catalog.de.labels.other
};

export const paidByLabels: Record<PaidBy, string> = {
  father: catalog.de.labels.father,
  mother: catalog.de.labels.mother,
  both: catalog.de.labels.both,
  thirdParty: catalog.de.labels.thirdParty
};

export const holidayAssignmentLabels = {
  father: catalog.de.labels.father,
  mother: catalog.de.labels.mother,
  shared: catalog.de.labels.shared
} as const;

export const unavailableCategoryLabels: Record<UnavailableCategory, string> = {
  duty: catalog.de.labels.duty,
  training_course: catalog.de.labels.trainingCourse,
  exercise: catalog.de.labels.exercise,
  guard_duty: catalog.de.labels.guardDuty,
  standby: catalog.de.labels.standby,
  deployment: catalog.de.labels.deployment,
  business_trip: catalog.de.labels.businessTrip,
  illness: catalog.de.labels.illness,
  private_unavailability: catalog.de.labels.privateUnavailability,
  vacation_without_children: catalog.de.labels.vacationWithoutChildren,
  other: catalog.de.labels.other
};

const localizedLabels = {
  de: {
    status: statusLabels,
    costCategory: costCategoryLabels,
    unavailableCategory: unavailableCategoryLabels
  },
  en: {
    status: { completed: catalog.en.labels.completed, planned: catalog.en.labels.planned, cancelled: catalog.en.labels.cancelled },
    costCategory: { food: catalog.en.labels.food, leisure: catalog.en.labels.leisure, school: catalog.en.labels.school, clothing: catalog.en.labels.clothing, travel: catalog.en.labels.travel, other: catalog.en.labels.other },
    unavailableCategory: { duty: catalog.en.labels.duty, training_course: catalog.en.labels.trainingCourse, exercise: catalog.en.labels.exercise, guard_duty: catalog.en.labels.guardDuty, standby: catalog.en.labels.standby, deployment: catalog.en.labels.deployment, business_trip: catalog.en.labels.businessTrip, illness: catalog.en.labels.illness, private_unavailability: catalog.en.labels.privateUnavailability, vacation_without_children: catalog.en.labels.vacationWithoutChildren, other: catalog.en.labels.other }
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

export function locationLabel(location: CareLocation, locale: AppLocale): string {
  const labels = catalog[locale].labels;
  return {
    commuterApartment: labels.commuterApartment,
    mainResidence: labels.mainResidence,
    mother: labels.locationMother,
    school: labels.school,
    ogs: labels.ogs,
    other: labels.otherLocation
  }[location];
}

export function handoverLabel(party: HandoverParty, locale: AppLocale): string {
  const labels = catalog[locale].labels;
  return {
    mother: labels.mother,
    father: labels.father,
    school: labels.school,
    ogs: labels.ogs,
    thirdParty: labels.thirdParty
  }[party];
}

export function tripPurposeLabel(purpose: TripPurpose, locale: AppLocale): string {
  const labels = catalog[locale].labels;
  return {
    pickup: labels.pickup,
    return: labels.return,
    school: labels.school,
    doctor: labels.doctor,
    leisure: labels.leisure,
    workplace: labels.workplace,
    other: labels.other
  }[purpose];
}

export function paidByLabel(paidBy: PaidBy, locale: AppLocale): string {
  const labels = catalog[locale].labels;
  return {
    father: labels.father,
    mother: labels.mother,
    both: labels.both,
    thirdParty: labels.thirdParty
  }[paidBy];
}

export function holidayAssignmentLabel(
  assignment: keyof typeof holidayAssignmentLabels,
  locale: AppLocale
): string {
  const labels = catalog[locale].labels;
  return { father: labels.father, mother: labels.mother, shared: labels.shared }[assignment];
}
