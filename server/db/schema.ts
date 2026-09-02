import type { Generated } from "kysely";

type NullableText = string | null;
type DefaultText = Generated<string>;
type DefaultInteger = Generated<number>;

interface ActorColumns {
  created_by: string;
  updated_by: string;
}

interface DefaultActorColumns {
  created_by: DefaultText;
  updated_by: DefaultText;
}

interface TimestampColumns {
  created_at: string;
  updated_at: string;
}

interface SoftDeleteColumns extends TimestampColumns {
  deleted_at: NullableText;
}

interface AppInvitationsTable extends DefaultActorColumns {
  id: string;
  token_hash: string;
  email_hint: NullableText;
  role: string;
  expires_at: string;
  accepted_user_id: NullableText;
  accepted_at: NullableText;
  revoked_at: NullableText;
  created_at: DefaultText;
  updated_at: DefaultText;
  deleted_at: NullableText;
  data_transfer_actor_id: NullableText;
}

interface AppMembershipsTable extends DefaultActorColumns {
  id: string;
  user_id: string;
  role: string;
  created_at: DefaultText;
  updated_at: DefaultText;
  deleted_at: NullableText;
}

interface AppUserCarePartyAssignmentsTable extends DefaultActorColumns {
  id: string;
  user_id: string;
  care_party_id: string;
  created_at: DefaultText;
  updated_at: DefaultText;
  deleted_at: NullableText;
}

interface AppUsersTable extends TimestampColumns {
  id: string;
  external_subject: string;
  email: NullableText;
  display_name: string;
  role: string;
  groups_json: DefaultText;
  last_seen_at: string;
  deleted_at: NullableText;
}

interface AuditLogTable extends TimestampColumns {
  id: Generated<number>;
  timestamp: string;
  user_email: string;
  entity_type: string;
  entity_id: string;
  action: string;
  field_name: NullableText;
  old_value: NullableText;
  new_value: NullableText;
  metadata_json: NullableText;
  deleted_at: NullableText;
}

interface CalendarFeedTokensTable {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_used_at: NullableText;
  revoked_at: NullableText;
  scope_type: DefaultText;
  scope_party_id: NullableText;
}

interface CareConfirmationRequestsTable extends SoftDeleteColumns {
  id: string;
  care_entry_id: string;
  user_id: string;
  due_at: string;
  sent_at: NullableText;
  answered_at: NullableText;
  status: DefaultText;
  reminder_count: DefaultInteger;
  next_reminder_at: NullableText;
}

interface CareEntriesTable extends SoftDeleteColumns, ActorColumns {
  id: string;
  start_datetime: string;
  end_datetime: string;
  status: string;
  care_scope: string;
  cancellation_reason: NullableText;
  confirmation_note: NullableText;
  confirmed_at: NullableText;
  confirmed_by: NullableText;
  overnight: DefaultInteger;
  school_handover: DefaultInteger;
  holiday: DefaultInteger;
  weekend: DefaultInteger;
  additional_care: DefaultInteger;
  location: NullableText;
  handover_from: NullableText;
  handover_to: NullableText;
  notes: NullableText;
  evidence_reference: NullableText;
  has_evidence: DefaultInteger;
  duration_minutes: number;
  is_contact_time: DefaultInteger;
  generated_by_pattern_id: NullableText;
  rule_occurrence_date: NullableText;
  custom_location: NullableText;
  contact_rule_id: NullableText;
  contact_rule_segment_id: NullableText;
  contact_rule_occurrence_key: NullableText;
  responsible_party_id: NullableText;
  contact_rule_sync_state: NullableText;
  actual_start_datetime: NullableText;
  actual_end_datetime: NullableText;
  actual_responsible_party_id: NullableText;
  planned_start_datetime: NullableText;
  planned_end_datetime: NullableText;
  deviation_type: NullableText;
  deviation_note: NullableText;
  confirmation_suppressed: DefaultInteger;
}

interface CareEntryActualChildrenTable {
  care_entry_id: string;
  child_id: string;
  created_at: DefaultText;
  updated_at: DefaultText;
  deleted_at: NullableText;
}

interface CareEntryChildrenTable extends SoftDeleteColumns {
  care_entry_id: string;
  child_id: string;
}

interface CarePartiesTable extends DefaultActorColumns {
  id: string;
  name: string;
  kind: DefaultText;
  created_at: DefaultText;
  updated_at: DefaultText;
  deleted_at: NullableText;
}

interface ChildrenTable extends SoftDeleteColumns, DefaultActorColumns {
  id: string;
  name: string;
  birth_month: number;
  birth_year: number;
  color: string;
}

interface ContactPatternChildrenTable extends SoftDeleteColumns {
  contact_pattern_id: string;
  child_id: string;
}

interface ContactPatternsTable extends SoftDeleteColumns, DefaultActorColumns {
  id: string;
  name: string;
  start_date: string;
  frequency: DefaultText;
  friday_start_time: string;
  sunday_end_time: string;
  active: DefaultInteger;
}

interface ContactRuleChildrenTable extends SoftDeleteColumns {
  contact_rule_id: string;
  child_id: string;
}

interface ContactRulesTable extends SoftDeleteColumns, ActorColumns {
  id: string;
  name: string;
  start_date: string;
  end_date: NullableText;
  timezone: DefaultText;
  recurrence_json: string;
  segments_json: string;
  sync_horizon_months: DefaultInteger;
  responsible_party_id: NullableText;
  active: DefaultInteger;
  source_contact_pattern_id: NullableText;
}

interface CostsTable extends SoftDeleteColumns, DefaultActorColumns {
  id: string;
  care_entry_id: string;
  category: string;
  amount: number;
  paid_by: string;
  notes: NullableText;
}

interface DataTransferActorCarePartiesTable {
  actor_id: string;
  source_care_party_id: string;
  target_care_party_id: NullableText;
  created_at: DefaultText;
  updated_at: DefaultText;
}

interface DataTransferActorsTable extends ActorColumns {
  id: string;
  transfer_run_id: string;
  source_ref: string;
  display_name: string;
  email_hint: NullableText;
  suggested_role: NullableText;
  mapped_user_id: NullableText;
  invitation_id: NullableText;
  created_at: DefaultText;
  updated_at: DefaultText;
}

interface DataTransferRunsTable {
  id: string;
  package_fingerprint: string;
  format_version: number;
  source_version: string;
  result: string;
  counts_json: string;
  warnings_json: DefaultText;
  created_by: string;
  created_at: DefaultText;
  imported_at: NullableText;
}

interface ExternalCalendarEventsTable extends TimestampColumns {
  id: string;
  source_id: string;
  ical_uid: string;
  recurrence_id: DefaultText;
  title: string;
  description: NullableText;
  start_datetime: string;
  end_datetime: string;
  all_day: number;
  location: NullableText;
  raw_hash: string;
}

interface ExternalCalendarSourcesTable extends TimestampColumns {
  id: string;
  name: string;
  color: string;
  visible: DefaultInteger;
  last_imported_at: string;
  source_type: DefaultText;
  source_kind: DefaultText;
  feed_url: NullableText;
  last_refresh_at: NullableText;
  last_refresh_error: NullableText;
}

interface HolidayPeriodChildrenTable extends SoftDeleteColumns {
  holiday_period_id: string;
  child_id: string;
}

interface HolidayPeriodsTable extends SoftDeleteColumns, DefaultActorColumns {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  assigned_to: string;
  notes: NullableText;
  source_external_calendar_source_id: NullableText;
  source_external_calendar_event_id: NullableText;
}

interface LegacyMigrationRunsTable {
  id: string;
  source_fingerprint: string;
  mode: string;
  status: string;
  report_json: string;
  backup_filename: NullableText;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface MonthlyClosingsTable extends SoftDeleteColumns {
  id: string;
  month_key: string;
  summary_json: string;
  closed_by: string;
  changed_after_close_at: NullableText;
  updated_by: DefaultText;
}

interface NativeOidcLoginStatesTable {
  state: string;
  nonce: string;
  pkce_verifier: string;
  redirect_uri: string;
  created_at: string;
  expires_at: string;
  consumed_at: NullableText;
  context_type: DefaultText;
  context_token_hash: NullableText;
}

interface NativeOidcSessionsTable {
  id: string;
  session_hash: string;
  external_subject: string;
  created_at: string;
  last_seen_at: NullableText;
  expires_at: string;
  revoked_at: NullableText;
}

interface NotificationPreferencesTable extends SoftDeleteColumns {
  id: string;
  user_id: string;
  event_type: string;
  in_app_enabled: DefaultInteger;
  push_enabled: DefaultInteger;
  email_enabled: DefaultInteger;
}

interface OwnerSetupTokensTable {
  token_hash: string;
  created_at: string;
  expires_at: string;
  consumed_at: NullableText;
  consumed_by: NullableText;
}

interface PushSubscriptionsTable extends SoftDeleteColumns {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: NullableText;
}

interface RecoveryAdminCredentialsTable extends TimestampColumns {
  username: string;
  password_hash: string;
  password_salt: string;
  password_changed_at: string;
}

interface RecoveryAdminSessionsTable {
  id: string;
  session_hash: string;
  username: string;
  password_change_required: DefaultInteger;
  created_at: string;
  last_seen_at: NullableText;
  expires_at: string;
  revoked_at: NullableText;
}

interface SchemaMigrationsTable {
  version: string;
  applied_at: string;
}

interface SettingsTable extends SoftDeleteColumns, DefaultActorColumns {
  key: string;
  value_json: string;
}

interface TripsTable extends SoftDeleteColumns, DefaultActorColumns {
  id: string;
  care_entry_id: string;
  purpose: string;
  km: number;
  own_car: DefaultInteger;
  reimbursed: DefaultInteger;
  reimbursement_amount: number | null;
  notes: NullableText;
}

interface UnavailablePeriodChildrenTable extends SoftDeleteColumns {
  unavailable_period_id: string;
  child_id: string;
}

interface UnavailablePeriodsTable extends SoftDeleteColumns, ActorColumns {
  id: string;
  start_datetime: string;
  end_datetime: string;
  category: string;
  duty_related: DefaultInteger;
  affects_contact: DefaultInteger;
  affects_holidays: DefaultInteger;
  location: NullableText;
  notes: NullableText;
  has_evidence: DefaultInteger;
  evidence_reference: NullableText;
  scope: DefaultText;
  responsible_party_id: NullableText;
}

export interface DatabaseSchema {
  app_invitations: AppInvitationsTable;
  app_memberships: AppMembershipsTable;
  app_user_care_party_assignments: AppUserCarePartyAssignmentsTable;
  app_users: AppUsersTable;
  audit_log: AuditLogTable;
  calendar_feed_tokens: CalendarFeedTokensTable;
  care_confirmation_requests: CareConfirmationRequestsTable;
  care_entries: CareEntriesTable;
  care_entry_actual_children: CareEntryActualChildrenTable;
  care_entry_children: CareEntryChildrenTable;
  care_parties: CarePartiesTable;
  children: ChildrenTable;
  contact_pattern_children: ContactPatternChildrenTable;
  contact_patterns: ContactPatternsTable;
  contact_rule_children: ContactRuleChildrenTable;
  contact_rules: ContactRulesTable;
  costs: CostsTable;
  data_transfer_actor_care_parties: DataTransferActorCarePartiesTable;
  data_transfer_actors: DataTransferActorsTable;
  data_transfer_runs: DataTransferRunsTable;
  external_calendar_events: ExternalCalendarEventsTable;
  external_calendar_sources: ExternalCalendarSourcesTable;
  holiday_period_children: HolidayPeriodChildrenTable;
  holiday_periods: HolidayPeriodsTable;
  legacy_migration_runs: LegacyMigrationRunsTable;
  monthly_closings: MonthlyClosingsTable;
  native_oidc_login_states: NativeOidcLoginStatesTable;
  native_oidc_sessions: NativeOidcSessionsTable;
  notification_preferences: NotificationPreferencesTable;
  owner_setup_tokens: OwnerSetupTokensTable;
  push_subscriptions: PushSubscriptionsTable;
  recovery_admin_credentials: RecoveryAdminCredentialsTable;
  recovery_admin_sessions: RecoveryAdminSessionsTable;
  schema_migrations: SchemaMigrationsTable;
  settings: SettingsTable;
  trips: TripsTable;
  unavailable_period_children: UnavailablePeriodChildrenTable;
  unavailable_periods: UnavailablePeriodsTable;
}

export const databaseTableNames = [
  "app_invitations",
  "app_memberships",
  "app_user_care_party_assignments",
  "app_users",
  "audit_log",
  "calendar_feed_tokens",
  "care_confirmation_requests",
  "care_entries",
  "care_entry_actual_children",
  "care_entry_children",
  "care_parties",
  "children",
  "contact_pattern_children",
  "contact_patterns",
  "contact_rule_children",
  "contact_rules",
  "costs",
  "data_transfer_actor_care_parties",
  "data_transfer_actors",
  "data_transfer_runs",
  "external_calendar_events",
  "external_calendar_sources",
  "holiday_period_children",
  "holiday_periods",
  "legacy_migration_runs",
  "monthly_closings",
  "native_oidc_login_states",
  "native_oidc_sessions",
  "notification_preferences",
  "owner_setup_tokens",
  "push_subscriptions",
  "recovery_admin_credentials",
  "recovery_admin_sessions",
  "schema_migrations",
  "settings",
  "trips",
  "unavailable_period_children",
  "unavailable_periods"
] as const satisfies readonly (keyof DatabaseSchema)[];

type MissingDatabaseTable = Exclude<keyof DatabaseSchema, typeof databaseTableNames[number]>;
const allDatabaseTablesAreListed: MissingDatabaseTable extends never ? true : never = true;
void allDatabaseTablesAreListed;
