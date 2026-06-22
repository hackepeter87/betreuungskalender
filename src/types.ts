export const SCHEMA_VERSION = 4 as const;

export type EntryStatus = "planned" | "completed" | "cancelled";
export type CareLocation =
  | "commuterApartment"
  | "mainResidence"
  | "mother"
  | "school"
  | "ogs"
  | "other";
export type HandoverParty = "mother" | "father" | "school" | "ogs" | "thirdParty";
export type TripPurpose =
  | "pickup"
  | "return"
  | "school"
  | "doctor"
  | "leisure"
  | "workplace"
  | "other";
export type CostCategory =
  | "food"
  | "leisure"
  | "school"
  | "clothing"
  | "travel"
  | "other";
export type PaidBy = "father" | "mother" | "both" | "thirdParty";

export type RequirementLevel = "required" | "recommended" | "optional";

export interface FieldHelp {
  fieldId: string;
  label: string;
  shortHelp: string;
  whyRelevant: string;
  usedFor: string;
  inputGuidance: string;
  commonMistakes?: string[];
  requirementLevel: RequirementLevel;
  examples?: string[];
  relatedReportSection?: string;
}

export interface Child {
  id: string;
  name: string;
  birthMonth: number;
  birthYear: number;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Trip {
  id: string;
  purpose: TripPurpose;
  km: number;
  ownCar: boolean;
  reimbursed: boolean;
  reimbursementAmount?: number;
  notes?: string;
  deletedAt?: string;
}

export interface Cost {
  id: string;
  category: CostCategory;
  amount: number;
  paidBy: PaidBy;
  notes?: string;
  deletedAt?: string;
}

export interface CareEntry {
  id: string;
  date: string;
  startDateTime: string;
  endDateTime: string;
  childIds: string[];
  status: EntryStatus;
  additionalCare: boolean;
  generatedByPatternId?: string;
  ruleOccurrenceDate?: string;
  overnight: boolean;
  schoolHandover: boolean;
  holiday: boolean;
  weekend: boolean;
  location: CareLocation;
  customLocation?: string;
  handoverFrom: HandoverParty;
  handoverTo: HandoverParty;
  cancellationReason?: string;
  notes?: string;
  hasEvidence: boolean;
  evidenceReference?: string;
  trips: Trip[];
  costs: Cost[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface HolidayPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  childIds: string[];
  assignedTo: "father" | "mother" | "shared";
  notes?: string;
  deletedAt?: string;
}

export interface ContactPattern {
  id: string;
  name: string;
  startDate: string;
  frequency: "biweekly";
  fridayStartTime: string;
  sundayEndTime: string;
  childIds: string[];
  active: boolean;
}

export type UnavailableCategory =
  | "duty"
  | "training_course"
  | "exercise"
  | "guard_duty"
  | "standby"
  | "deployment"
  | "business_trip"
  | "illness"
  | "private_unavailability"
  | "vacation_without_children"
  | "other";

export interface UnavailablePeriod {
  id: string;
  startDateTime: string;
  endDateTime: string;
  category: UnavailableCategory;
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
  deletedAt?: string;
}

export interface ExternalCalendarSource {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  lastImportedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalCalendarEvent {
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

export interface ExternalCalendarBackupEvent {
  id: string;
  sourceId: string;
  icalUid: string;
  recurrenceId: string;
  title: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  allDay: boolean;
  location?: string;
  rawHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  kilometerRate: number;
  defaultLocation: CareLocation;
  defaultHandoverFrom: HandoverParty;
  defaultHandoverTo: HandoverParty;
  rhythmStartDate?: string;
}

export type AuditObjectType =
  | "careEntry"
  | "trip"
  | "cost"
  | "holiday"
  | "unavailablePeriod"
  | "child"
  | "contactPattern"
  | "settings"
  | "monthClosure"
  | "appData"
  | "legacyMigration";
export type AuditAction = "created" | "updated" | "deleted" | "postCloseChange";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  objectType: AuditObjectType;
  objectId: string;
  objectLabel: string;
  field: string;
  oldValue: string;
  newValue: string;
  action: AuditAction;
  effectiveDate?: string;
}

export interface DataQualityStats {
  incompleteEntries: number;
  cancellationsWithoutReason: number;
  tripsWithoutPurpose: number;
  costsWithoutCategory: number;
  overduePlannedEntries: number;
  totalIssues: number;
}

export interface MonthlyClosureSummary {
  entryCount: number;
  careDays: number;
  overnights: number;
  weekends: number;
  completedEntries: number;
  plannedEntries: number;
  cancelledEntries: number;
  completeness: number;
  dataQuality: DataQualityStats;
  warnings: string[];
}

export interface MonthlyClosure {
  monthKey: string;
  closedAt: string;
  dataUpdatedAt: string;
  summary: MonthlyClosureSummary;
  changedAfterCloseAt?: string;
}

export interface AppData {
  schemaVersion: typeof SCHEMA_VERSION;
  children: Child[];
  entries: CareEntry[];
  holidayPeriods: HolidayPeriod[];
  unavailablePeriods: UnavailablePeriod[];
  externalCalendarSources: ExternalCalendarSource[];
  externalCalendarEvents: ExternalCalendarBackupEvent[];
  contactPatterns: ContactPattern[];
  auditLog: AuditLogEntry[];
  monthClosures: MonthlyClosure[];
  lastJsonBackupAt?: string;
  settings: AppSettings;
  updatedAt: string;
}

export interface BackupEnvelope {
  application: "betreuungskalender";
  exportedAt: string;
  data: AppData;
}

export interface MonthlyChildStats {
  childId: string;
  careDays: number;
  overnights: number;
  weekendDays: number;
  weekends: number;
  schoolHandovers: number;
  weekdayOvernights: number;
  plannedEntries: number;
  completedEntries: number;
  cancelledEntries: number;
}

export interface MonthlyStats {
  monthKey: string;
  careDays: number;
  overnights: number;
  weekends: number;
  completeness: number;
  completedEntries: number;
  plannedEntries: number;
  cancelledEntries: number;
  byChild: MonthlyChildStats[];
}

export interface ContactStats {
  scheduled: number;
  pending: number;
  completed: number;
  cancelled: number;
  cancelledDutyRelated: number;
  cancelledOther: number;
  unavailableOverlaps: number;
  additional: number;
}

export interface HolidayStats {
  totalDays: number;
  fatherDays: number;
  motherDays: number;
  fatherQuote: number;
  halfTarget: number;
  differenceFromHalf: number;
  unavailablePeriods: number;
}

export interface PeriodChildStats {
  childId?: string;
  careHours: number;
  careDays: number;
  overnights: number;
  weekendDays: number;
  weekends: number;
  schoolHandovers: number;
  weekdayOvernights: number;
  additionalEntries: number;
  holidayDays: number;
  plannedEntries: number;
  completedEntries: number;
  cancelledEntries: number;
  careDayQuote: number;
  overnightQuote: number;
  tripKm: number;
  calculatedTravelCost: number;
  reimbursedAmount: number;
  costsTotal: number;
}

export interface PeriodStats extends PeriodChildStats {
  startDate: string;
  endDate: string;
  totalDays: number;
  completeness: number;
  contact: ContactStats;
  holidays: HolidayStats;
  costsByCategory: Record<CostCategory, number>;
  byChild: PeriodChildStats[];
}
