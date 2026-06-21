export const careScopes = [
  "overnight",
  "full_day",
  "half_day",
  "hourly",
  "evening_care",
  "visit_contact",
  "walk_leisure_contact",
  "school_ogs_pickup",
  "school_ogs_dropoff",
  "appointment_accompaniment",
  "other"
] as const;

export type CareScope = (typeof careScopes)[number];
export type ApiEntryStatus = "planned" | "completed" | "cancelled";

export const unavailableCategories = [
  "duty",
  "training_course",
  "exercise",
  "guard_duty",
  "standby",
  "deployment",
  "business_trip",
  "illness",
  "private_unavailability",
  "vacation_without_children",
  "other"
] as const;

export type ApiUnavailableCategory = (typeof unavailableCategories)[number];

export interface ApiChild {
  id: string;
  name: string;
  birthMonth: number;
  birthYear: number;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTrip {
  id: string;
  purpose: string;
  km: number;
  ownCar: boolean;
  reimbursed: boolean;
  reimbursementAmount?: number;
  notes?: string;
}

export interface ApiCost {
  id: string;
  category: string;
  amount: number;
  paidBy: string;
  notes?: string;
}

export interface ApiCareEntry {
  id: string;
  generatedByPatternId?: string;
  ruleOccurrenceDate?: string;
  startDateTime: string;
  endDateTime: string;
  childIds: string[];
  status: ApiEntryStatus;
  careScope: CareScope;
  cancellationReason?: string;
  overnight: boolean;
  schoolHandover: boolean;
  holiday: boolean;
  weekend: boolean;
  additionalCare: boolean;
  location?: string;
  customLocation?: string;
  handoverFrom?: string;
  handoverTo?: string;
  notes?: string;
  evidenceReference?: string;
  hasEvidence: boolean;
  durationMinutes: number;
  isContactTime: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  trips: ApiTrip[];
  costs: ApiCost[];
}

export interface ApiMonthlyClosing {
  monthKey: string;
  closedAt: string;
  dataUpdatedAt: string;
  summary: unknown;
  changedAfterCloseAt?: string;
}

export interface ApiAuditEntry {
  id: number;
  timestamp: string;
  userEmail: string;
  entityType: string;
  entityId: string;
  action: "created" | "updated" | "deleted" | "post_close_change";
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  metadataJson?: string;
}

export interface ApiUnavailablePeriod {
  id: string;
  startDateTime: string;
  endDateTime: string;
  category: ApiUnavailableCategory;
  dutyRelated: boolean;
  affectsContact: boolean;
  affectsHolidays: boolean;
  location?: string;
  notes?: string;
  hasEvidence: boolean;
  evidenceReference?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  warnings: string[];
}

export interface ApiExternalCalendarSource {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  lastImportedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiExternalCalendarEvent {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceColor: string;
  title: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  allDay: boolean;
  location?: string;
}

export type ExternalCalendarErrorCode =
  | "external_calendar_invalid"
  | "external_calendar_limit"
  | "external_calendar_recurrence_unsupported"
  | "external_calendar_not_found";
