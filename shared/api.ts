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
export type ApiEntryStatus = "planned" | "completed" | "cancelled" | "partial";
export type ApiCareConflictSeverity = "planned_warning" | "unresolved_actual";
export type ApiAuthRole = "admin" | "parent" | "readonly";
export type ApiWorkspaceRole = "admin" | "editor" | "scheduler" | "viewer";
export type ApiWorkspacePermission =
  | "appointments:view"
  | "appointments:create"
  | "appointments:edit"
  | "appointments:delete"
  | "appointments:confirm"
  | "children:view-basic"
  | "children:view-sensitive"
  | "children:manage"
  | "notes:view"
  | "planning:view"
  | "planning:manage"
  | "reports:view"
  | "settings:view"
  | "settings:manage"
  | "notifications:manage-own"
  | "feeds:manage-own"
  | "audit:view"
  | "instance:inspect"
  | "members:manage"
  | "exports:run"
  | "admin:destructive";
export type ApiCareDeviationType =
  | "cancelled"
  | "partial"
  | "rescheduled"
  | "swapped"
  | "externally_blocked"
  | "other";
export type ApiCareConfirmationStatus = "open" | "answered" | "snoozed";
export type ApiNotificationEventType = "care_confirmation_due" | "care_confirmation_reminder";

export const careLocations = [
  "commuterApartment",
  "mainResidence",
  "mother",
  "school",
  "ogs",
  "other"
] as const;

export type ApiCareLocation = (typeof careLocations)[number];

export const handoverParties = [
  "mother",
  "father",
  "school",
  "ogs",
  "thirdParty"
] as const;

export type ApiHandoverParty = (typeof handoverParties)[number];

export interface ApiAppSettings {
  kilometerRate: number;
  defaultLocation: ApiCareLocation;
  defaultHandoverFrom: ApiHandoverParty;
  defaultHandoverTo: ApiHandoverParty;
  primaryCarePartyId?: string;
  defaultResponsiblePartyId?: string;
  rhythmStartDate?: string;
  lastJsonBackupAt?: string;
}

export type ApiWritableSettings = Partial<ApiAppSettings>;

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
export type ApiUnavailableScope = "own_unavailability" | "external_contact_block";

export const carePartyKinds = [
  "father",
  "mother",
  "grandparent",
  "foster_caregiver",
  "other"
] as const;

export type ApiCarePartyKind = (typeof carePartyKinds)[number];

export interface ApiChild {
  id: string;
  name: string;
  birthMonth: number;
  birthYear: number;
  color: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiChildSummary {
  id: string;
  name: string;
  color: string;
}

export interface ApiCareParty {
  id: string;
  name: string;
  kind: ApiCarePartyKind;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCarePartySummary {
  id: string;
  name: string;
}

export interface ApiScheduleEntry {
  id: string;
  children: ApiChildSummary[];
  startDateTime: string;
  endDateTime: string;
  status: ApiEntryStatus;
  responsibleParty?: ApiCarePartySummary;
  location?: string;
  hasConflict: boolean;
}

export interface ApiTrip {
  id: string;
  purpose: string;
  km: number;
  ownCar: boolean;
  reimbursed: boolean;
  reimbursementAmount?: number;
  notes?: string;
  createdBy: string;
  updatedBy: string;
}

export interface ApiCost {
  id: string;
  category: string;
  amount: number;
  paidBy: string;
  notes?: string;
  createdBy: string;
  updatedBy: string;
}

export interface ApiCareEntry {
  id: string;
  generatedByPatternId?: string;
  ruleOccurrenceDate?: string;
  contactRuleId?: string;
  contactRuleSegmentId?: string;
  contactRuleOccurrenceKey?: string;
  responsiblePartyId?: string;
  actualResponsiblePartyId?: string;
  contactRuleSyncState?: "generated" | "manual_override";
  startDateTime: string;
  endDateTime: string;
  plannedStartDateTime?: string;
  plannedEndDateTime?: string;
  actualStartDateTime?: string;
  actualEndDateTime?: string;
  childIds: string[];
  actualChildIds?: string[];
  status: ApiEntryStatus;
  deviationType?: ApiCareDeviationType;
  deviationNote?: string;
  confirmationState?: "unconfirmed" | "confirmed";
  confirmedAt?: string;
  confirmedBy?: string;
  confirmationNote?: string;
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

export interface ApiCareConflict {
  id: string;
  entryIds: [string, string];
  childIds: string[];
  startDateTime: string;
  endDateTime: string;
  severity: ApiCareConflictSeverity;
}

export interface ApiCareConflictList {
  items: ApiCareConflict[];
  complete: boolean;
}

export interface ApiCareConflictPreviewItem {
  conflict: ApiCareConflict;
  entry: ApiCareEntry;
}

export interface ApiCareConflictPreview {
  fingerprint: string;
  items: ApiCareConflictPreviewItem[];
}

export interface ApiCareConflictResolutionInput {
  conflictId: string;
  entryId: string;
  action: "replace_rule_occurrence";
}

export interface ApiCareConfirmationRequest {
  id: string;
  careEntryId: string;
  userId: string;
  dueAt: string;
  sentAt?: string;
  answeredAt?: string;
  status: ApiCareConfirmationStatus;
  reminderCount: number;
  nextReminderAt?: string;
  createdAt: string;
  updatedAt: string;
  entry: ApiCareEntry;
}

export interface ApiCareConfirmationAnswer {
  status: "completed" | "cancelled" | "partial";
  note?: string;
  cancellationReason?: string;
  actualStartDateTime?: string;
  actualEndDateTime?: string;
  actualChildIds?: string[];
  actualResponsiblePartyId?: string;
}

export interface ApiCareConfirmationRemindLater {
  nextReminderAt?: string;
}

export interface ApiNotificationPreference {
  eventType: ApiNotificationEventType;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
}

export interface ApiNotificationPreferencesResponse {
  preferences: ApiNotificationPreference[];
  pushAvailable: boolean;
  pushConfigured: boolean;
  vapidPublicKey?: string;
  activePushSubscriptions: number;
}

export interface ApiInstanceReadiness {
  instanceId: string;
  version: string;
  environment: string;
  authMode: "local" | "trusted-proxy" | "native-oidc";
  requireAuth: boolean;
  serverTime: string;
  timezone: string;
  database: {
    reachable: boolean;
    migrationsApplied: number;
    latestAppliedMigration?: string;
    latestAvailableMigration?: string;
    upToDate: boolean;
  };
  setup: {
    complete: boolean;
    children: number;
    careParties: number;
    appUsers: number;
  };
  features: {
    demoDatasetsEnabled: boolean;
    nativeOidc: boolean;
    trustedProxy: boolean;
    recoveryAdminEnabled: boolean;
    pushConfigured: boolean;
  };
}

export interface ApiSetupState {
  complete: boolean;
  required: boolean;
}

export interface ApiSetupCompletion {
  setup: ApiSetupState;
  completedAt: string;
  owner: {
    id: string;
    displayName: string;
    role: "admin";
    email?: string;
  };
}

export interface ApiSetupChildInput {
  name: string;
  birthMonth: number;
  birthYear: number;
  color: string;
}

export interface ApiSetupFirstUseInput {
  installationLabel?: string;
  ownerConfirmed: true;
  careParty: {
    name: string;
    kind: ApiCarePartyKind;
  };
  secondaryCareParty?: {
    name: string;
    kind: ApiCarePartyKind;
  };
  primaryCareParty?: "primary" | "secondary";
  defaultCareParty: "primary" | "secondary";
  children?: ApiSetupChildInput[];
  child?: ApiSetupChildInput;
}

export interface ApiSetupFirstUse extends ApiSetupCompletion {
  created: {
    carePartyId: string;
    secondaryCarePartyId?: string;
    primaryCarePartyId: string;
    defaultCarePartyId: string;
    childIds: string[];
    childId?: string;
  };
}

export interface ApiInvitation {
  id: string;
  role: ApiWorkspaceRole;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  emailHint?: string;
  acceptedUserId?: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export interface ApiCreatedInvitation {
  invitation: ApiInvitation;
  invitationUrl: string;
  emailDelivery?: {
    status: "not_requested" | "sent" | "failed";
    message?: string;
  };
}

export interface ApiTransferActorSnapshot {
  sourceRef: string;
  displayName: string;
  email?: string;
  suggestedRole?: ApiWorkspaceRole;
  carePartyIds: string[];
  mappingRequired: true;
}

export type ApiTransferCategoryCode =
  | "children"
  | "care_parties"
  | "care_entries"
  | "holiday_periods"
  | "unavailable_periods"
  | "external_calendar_sources"
  | "external_calendar_events"
  | "contact_patterns"
  | "contact_rules"
  | "audit_records"
  | "month_closures";

export type ApiTransferCheckCode =
  | "checksum"
  | "format"
  | "schema"
  | "references"
  | "sqlite_foreign_keys"
  | "sqlite_integrity";

export interface ApiTransferComparison {
  category: ApiTransferCategoryCode;
  current: number;
  incoming: number;
  afterImport: number;
}

export interface ApiTransferCheck {
  code: ApiTransferCheckCode;
  status: "passed" | "warning" | "failed" | "not_run";
}

export interface ApiTransferSummary {
  currentRecords: number;
  incomingRecords: number;
  replacedRecords: number;
  warnings: number;
  actorMappingsRequired: number;
}

export interface ApiTransferDryRunResult {
  fingerprint: string;
  formatVersion: number;
  sourceVersion: string;
  exportedAt?: string;
  result: "ready" | "warnings" | "blocked";
  counts: Record<string, number>;
  comparison: ApiTransferComparison[];
  checks: ApiTransferCheck[];
  summary: ApiTransferSummary;
  skippedRuntimeCodes: string[];
  skippedRuntimeData: string[];
  missingReferences: string[];
  warnings: string[];
  actors: ApiTransferActorSnapshot[];
  dryRunReceipt?: string;
}

export interface ApiImportedTransferActor {
  id: string;
  displayName: string;
  email?: string;
  suggestedRole?: ApiWorkspaceRole;
  mappedUserId?: string;
  invitationId?: string;
  packageFingerprint: string;
  carePartyIds: string[];
}

export interface ApiInvitationCapabilities {
  emailDeliveryAvailable: boolean;
}

export interface ApiMember {
  id: string;
  displayName: string;
  claimRole: ApiAuthRole;
  effectiveRole: ApiWorkspaceRole;
  owner: boolean;
  workspaceAccess: boolean;
  membershipRole?: ApiWorkspaceRole;
  email?: string;
  lastSeenAt?: string;
}

export interface ApiPushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface ApiMonthlyClosing {
  monthKey: string;
  closedAt: string;
  closedBy: string;
  dataUpdatedAt: string;
  summary: unknown;
  changedAfterCloseAt?: string;
  updatedBy: string;
}

export interface ApiAuditEntry {
  id: number;
  timestamp: string;
  userEmail: string;
  userDisplayName?: string;
  entityType: string;
  entityId: string;
  action: "created" | "updated" | "deleted" | "post_close_change";
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  metadataJson?: string;
  effectiveDate?: string;
}

export interface ApiAuditPage {
  items: ApiAuditEntry[];
  nextCursor?: string;
}

export interface ApiActorLabel {
  id: string;
  displayName: string;
}

export interface ApiReportSnapshot {
  reportId: string;
  generatedAt: string;
  startDate: string;
  endDate: string;
  dataUpdatedAt: string;
  data: {
    schemaVersion: number;
    children: ApiChild[];
    careParties: ApiCareParty[];
    entries: ApiCareEntry[];
    holidayPeriods: ApiHolidayPeriod[];
    unavailablePeriods: ApiUnavailablePeriod[];
    settings: ApiAppSettings;
    auditLog: ApiAuditEntry[];
    monthClosures: ApiMonthlyClosing[];
  };
}

export interface ApiSession {
  authRequired: boolean;
  authenticated: boolean;
  demoDatasetsEnabled?: boolean;
  setup: ApiSetupState;
  workspaceAccess?: boolean;
  workspaceRole?: ApiWorkspaceRole;
  isOwner?: boolean;
  permissions?: ApiWorkspacePermission[];
  user?: {
    id: string;
    displayName: string;
    role: ApiAuthRole;
    email?: string;
  };
  loginUrl?: string;
  logoutUrl?: string;
}

export type ApiCalendarFeedScope = "legacy" | "all" | `party:${string}`;
export type ApiExternalCalendarSourceType = "overlay" | "holiday";
export type ApiExternalCalendarSourceKind = "file" | "url";

export interface ApiLogout {
  authenticated: false;
  loggedOut: true;
  logoutRedirectUrl?: string;
}

export interface ApiCalendarFeedStatus {
  active: boolean;
  scope: ApiCalendarFeedScope;
  createdAt?: string;
  lastUsedAt?: string;
  feedUrl?: string;
}

export interface ApiCalendarFeedScopeOption {
  scope: ApiCalendarFeedScope;
  label: string;
}

export interface ApiAppUser {
  id: string;
  displayName: string;
  role: ApiAuthRole;
  email?: string;
  lastSeenAt: string;
}

export interface ApiUserCarePartyAssignment {
  userId: string;
  carePartyIds: string[];
}

export type ContactRuleWeekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export type ContactRuleMonthlyOrdinal = 1 | 2 | 3 | 4 | 5 | -1;

export type ContactRuleRecurrence =
  | {
      kind: "weekly";
      intervalWeeks: number;
      weekdays: ContactRuleWeekday[];
    }
  | {
      kind: "monthlyByWeekday";
      intervalMonths: number;
      ordinals: ContactRuleMonthlyOrdinal[];
      weekdays: ContactRuleWeekday[];
    }
  | {
      kind: "rrule";
      rrules: string[];
    };

export interface ApiContactRuleSegment {
  id: string;
  startDayOffset: number;
  startTime: string;
  endDayOffset: number;
  endTime: string;
}

export interface ApiContactRuleSyncSummary {
  startDate: string;
  endDate: string;
  created: number;
  updated: number;
  skipped: number;
  preserved: number;
}

export interface ApiContactRuleSyncPreview {
  fingerprint: string;
  startDate: string;
  endDate: string;
  create: number;
  alreadyPresent: number;
  manualExceptions: number;
  conflicts: number;
  pastOccurrences: number;
}

export interface ApiContactRule {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  timezone: string;
  recurrence: ContactRuleRecurrence;
  segments: ApiContactRuleSegment[];
  syncHorizonMonths: number;
  responsiblePartyId?: string;
  childIds: string[];
  active: boolean;
  sourceContactPatternId?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  syncSummary?: ApiContactRuleSyncSummary;
}

export interface ApiUnavailablePeriod {
  id: string;
  startDateTime: string;
  endDateTime: string;
  scope: ApiUnavailableScope;
  responsiblePartyId?: string;
  childIds: string[];
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

export interface ApiHolidayPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  childIds: string[];
  assignedTo: "father" | "mother" | "shared";
  notes?: string;
  sourceExternalCalendarSourceId?: string;
  sourceExternalCalendarEventId?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiExternalCalendarSource {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  sourceType: ApiExternalCalendarSourceType;
  sourceKind: ApiExternalCalendarSourceKind;
  feedUrlRedacted?: string;
  lastImportedAt: string;
  lastRefreshAt?: string;
  lastRefreshError?: string;
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

export interface ApiExternalCalendarBackupEvent {
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

export interface ApiExternalCalendarHolidayDeriveResult {
  source: ApiExternalCalendarSource;
  created: number;
  skippedExisting: number;
  skippedUnsupported: number;
  holidays: ApiHolidayPeriod[];
}

export type ExternalCalendarErrorCode =
  | "external_calendar_invalid"
  | "external_calendar_limit"
  | "external_calendar_fetch_failed"
  | "external_calendar_recurrence_unsupported"
  | "external_calendar_not_found";
