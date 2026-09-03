CREATE OR REPLACE FUNCTION bk_now_iso() RETURNS TEXT
LANGUAGE SQL
VOLATILE
AS $$
  SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE TABLE children (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_month INTEGER NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  birth_year INTEGER NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev'
);

CREATE TABLE care_parties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (
    kind IN ('father', 'mother', 'grandparent', 'foster_caregiver', 'other')
  ),
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT bk_now_iso(),
  updated_at TEXT NOT NULL DEFAULT bk_now_iso(),
  deleted_at TEXT
);

CREATE TABLE app_users (
  id TEXT PRIMARY KEY,
  external_subject TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'parent', 'readonly')),
  groups_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE contact_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'biweekly' CHECK (frequency = 'biweekly'),
  friday_start_time TEXT NOT NULL,
  sunday_end_time TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev'
);

CREATE TABLE contact_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  recurrence_json TEXT NOT NULL,
  segments_json TEXT NOT NULL,
  sync_horizon_months INTEGER NOT NULL DEFAULT 12 CHECK (sync_horizon_months BETWEEN 1 AND 36),
  responsible_party_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  source_contact_pattern_id TEXT REFERENCES contact_patterns(id),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE care_entries (
  id TEXT PRIMARY KEY,
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'completed', 'cancelled', 'partial')),
  care_scope TEXT NOT NULL CHECK (care_scope IN (
    'overnight', 'full_day', 'half_day', 'hourly', 'evening_care',
    'visit_contact', 'walk_leisure_contact', 'school_ogs_pickup',
    'school_ogs_dropoff', 'appointment_accompaniment', 'other'
  )),
  cancellation_reason TEXT,
  confirmation_note TEXT,
  confirmed_at TEXT,
  confirmed_by TEXT,
  overnight INTEGER NOT NULL DEFAULT 0 CHECK (overnight IN (0, 1)),
  school_handover INTEGER NOT NULL DEFAULT 0 CHECK (school_handover IN (0, 1)),
  holiday INTEGER NOT NULL DEFAULT 0 CHECK (holiday IN (0, 1)),
  weekend INTEGER NOT NULL DEFAULT 0 CHECK (weekend IN (0, 1)),
  additional_care INTEGER NOT NULL DEFAULT 0 CHECK (additional_care IN (0, 1)),
  location TEXT,
  handover_from TEXT,
  handover_to TEXT,
  notes TEXT,
  evidence_reference TEXT,
  has_evidence INTEGER NOT NULL DEFAULT 0 CHECK (has_evidence IN (0, 1)),
  duration_minutes INTEGER NOT NULL,
  is_contact_time INTEGER NOT NULL DEFAULT 0 CHECK (is_contact_time IN (0, 1)),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  generated_by_pattern_id TEXT,
  rule_occurrence_date TEXT,
  custom_location TEXT,
  contact_rule_id TEXT,
  contact_rule_segment_id TEXT,
  contact_rule_occurrence_key TEXT,
  responsible_party_id TEXT,
  contact_rule_sync_state TEXT CHECK (
    contact_rule_sync_state IS NULL OR contact_rule_sync_state IN ('generated', 'manual_override')
  ),
  actual_start_datetime TEXT,
  actual_end_datetime TEXT,
  actual_responsible_party_id TEXT,
  planned_start_datetime TEXT,
  planned_end_datetime TEXT,
  deviation_type TEXT,
  deviation_note TEXT,
  confirmation_suppressed INTEGER NOT NULL DEFAULT 0 CHECK (confirmation_suppressed IN (0, 1))
);

CREATE TABLE care_entry_children (
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (care_entry_id, child_id)
);

CREATE TABLE care_entry_actual_children (
  care_entry_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT bk_now_iso(),
  updated_at TEXT NOT NULL DEFAULT bk_now_iso(),
  deleted_at TEXT,
  PRIMARY KEY (care_entry_id, child_id)
);

CREATE TABLE contact_pattern_children (
  contact_pattern_id TEXT NOT NULL REFERENCES contact_patterns(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (contact_pattern_id, child_id)
);

CREATE TABLE contact_rule_children (
  contact_rule_id TEXT NOT NULL REFERENCES contact_rules(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (contact_rule_id, child_id)
);

CREATE TABLE holiday_periods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  assigned_to TEXT NOT NULL CHECK (assigned_to IN ('father', 'mother', 'shared')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  source_external_calendar_source_id TEXT,
  source_external_calendar_event_id TEXT
);

CREATE TABLE holiday_period_children (
  holiday_period_id TEXT NOT NULL REFERENCES holiday_periods(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (holiday_period_id, child_id)
);

CREATE TABLE unavailable_periods (
  id TEXT PRIMARY KEY,
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'duty', 'training_course', 'exercise', 'guard_duty', 'standby',
    'deployment', 'business_trip', 'illness', 'private_unavailability',
    'vacation_without_children', 'other'
  )),
  duty_related INTEGER NOT NULL DEFAULT 0 CHECK (duty_related IN (0, 1)),
  affects_contact INTEGER NOT NULL DEFAULT 0 CHECK (affects_contact IN (0, 1)),
  affects_holidays INTEGER NOT NULL DEFAULT 0 CHECK (affects_holidays IN (0, 1)),
  location TEXT,
  notes TEXT,
  has_evidence INTEGER NOT NULL DEFAULT 0 CHECK (has_evidence IN (0, 1)),
  evidence_reference TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  scope TEXT NOT NULL DEFAULT 'own_unavailability' CHECK (
    scope IN ('own_unavailability', 'external_contact_block')
  ),
  responsible_party_id TEXT REFERENCES care_parties(id)
);

CREATE TABLE unavailable_period_children (
  unavailable_period_id TEXT NOT NULL REFERENCES unavailable_periods(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (unavailable_period_id, child_id)
);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  purpose TEXT NOT NULL,
  km DOUBLE PRECISION NOT NULL CHECK (km > 0),
  own_car INTEGER NOT NULL DEFAULT 1 CHECK (own_car IN (0, 1)),
  reimbursed INTEGER NOT NULL DEFAULT 0 CHECK (reimbursed IN (0, 1)),
  reimbursement_amount DOUBLE PRECISION,
  notes TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE costs (
  id TEXT PRIMARY KEY,
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  category TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  paid_by TEXT NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev'
);

CREATE TABLE monthly_closings (
  id TEXT PRIMARY KEY,
  month_key TEXT NOT NULL UNIQUE,
  summary_json TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  changed_after_close_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  updated_by TEXT NOT NULL DEFAULT 'local-dev'
);

CREATE TABLE audit_log (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  timestamp TEXT NOT NULL,
  user_email TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'post_close_change')),
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE legacy_migration_runs (
  id TEXT PRIMARY KEY,
  source_fingerprint TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('add', 'preview', 'replace')),
  status TEXT NOT NULL CHECK (status IN ('success', 'warning', 'failed')),
  report_json TEXT NOT NULL,
  backup_filename TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE native_oidc_login_states (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  context_type TEXT NOT NULL DEFAULT 'normal' CHECK (
    context_type IN ('normal', 'owner_setup', 'invitation')
  ),
  context_token_hash TEXT CHECK (
    context_token_hash IS NULL OR context_token_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE native_oidc_sessions (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  external_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE calendar_feed_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  scope_type TEXT NOT NULL DEFAULT 'legacy' CHECK (scope_type IN ('legacy', 'all', 'party')),
  scope_party_id TEXT
);

CREATE TABLE recovery_admin_credentials (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE recovery_admin_sessions (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password_change_required INTEGER NOT NULL DEFAULT 0 CHECK (password_change_required IN (0, 1)),
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE owner_setup_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_by TEXT REFERENCES app_users(id)
);

CREATE TABLE app_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'scheduler', 'viewer')),
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT bk_now_iso(),
  updated_at TEXT NOT NULL DEFAULT bk_now_iso(),
  deleted_at TEXT
);

CREATE TABLE app_user_care_party_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  care_party_id TEXT NOT NULL REFERENCES care_parties(id),
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT bk_now_iso(),
  updated_at TEXT NOT NULL DEFAULT bk_now_iso(),
  deleted_at TEXT
);

CREATE TABLE care_confirmation_requests (
  id TEXT PRIMARY KEY,
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  user_id TEXT NOT NULL REFERENCES app_users(id),
  due_at TEXT NOT NULL,
  sent_at TEXT,
  answered_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'snoozed')),
  reminder_count INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  next_reminder_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('care_confirmation_due', 'care_confirmation_reminder')
  ),
  in_app_enabled INTEGER NOT NULL DEFAULT 1 CHECK (in_app_enabled IN (0, 1)),
  push_enabled INTEGER NOT NULL DEFAULT 1 CHECK (push_enabled IN (0, 1)),
  email_enabled INTEGER NOT NULL DEFAULT 0 CHECK (email_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE external_calendar_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  last_imported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'overlay' CHECK (source_type IN ('overlay', 'holiday')),
  source_kind TEXT NOT NULL DEFAULT 'file' CHECK (source_kind IN ('file', 'url')),
  feed_url TEXT,
  last_refresh_at TEXT,
  last_refresh_error TEXT
);

CREATE TABLE external_calendar_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES external_calendar_sources(id) ON DELETE CASCADE,
  ical_uid TEXT NOT NULL,
  recurrence_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT,
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  location TEXT,
  raw_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_id, ical_uid, recurrence_id)
);

CREATE TABLE data_transfer_runs (
  id TEXT PRIMARY KEY,
  package_fingerprint TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  source_version TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('ready', 'warnings', 'imported', 'blocked')),
  counts_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT bk_now_iso(),
  imported_at TEXT
);

CREATE TABLE data_transfer_actors (
  id TEXT PRIMARY KEY,
  transfer_run_id TEXT NOT NULL REFERENCES data_transfer_runs(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email_hint TEXT,
  suggested_role TEXT CHECK (suggested_role IN ('admin', 'editor', 'scheduler', 'viewer')),
  mapped_user_id TEXT REFERENCES app_users(id),
  invitation_id TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT bk_now_iso(),
  updated_at TEXT NOT NULL DEFAULT bk_now_iso(),
  UNIQUE (transfer_run_id, source_ref)
);

CREATE TABLE app_invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email_hint TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'scheduler', 'viewer')),
  expires_at TEXT NOT NULL,
  accepted_user_id TEXT REFERENCES app_users(id),
  accepted_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT bk_now_iso(),
  updated_at TEXT NOT NULL DEFAULT bk_now_iso(),
  deleted_at TEXT,
  data_transfer_actor_id TEXT REFERENCES data_transfer_actors(id)
);

ALTER TABLE data_transfer_actors
  ADD CONSTRAINT data_transfer_actors_invitation_fk
  FOREIGN KEY (invitation_id) REFERENCES app_invitations(id);

CREATE TABLE data_transfer_actor_care_parties (
  actor_id TEXT NOT NULL REFERENCES data_transfer_actors(id) ON DELETE CASCADE,
  source_care_party_id TEXT NOT NULL,
  target_care_party_id TEXT REFERENCES care_parties(id),
  created_at TEXT NOT NULL DEFAULT bk_now_iso(),
  updated_at TEXT NOT NULL DEFAULT bk_now_iso(),
  PRIMARY KEY (actor_id, source_care_party_id)
);

CREATE INDEX idx_children_active ON children(deleted_at);
CREATE INDEX idx_care_parties_active ON care_parties(deleted_at, name);
CREATE INDEX idx_care_entries_range ON care_entries(start_datetime, end_datetime, deleted_at);
CREATE INDEX idx_care_entries_status ON care_entries(status, deleted_at);
CREATE INDEX idx_care_entries_generated_pattern ON care_entries(generated_by_pattern_id, rule_occurrence_date, deleted_at);
CREATE INDEX idx_care_entries_contact_rule ON care_entries(contact_rule_id, contact_rule_occurrence_key, deleted_at);
CREATE INDEX idx_care_entries_confirmation ON care_entries(status, end_datetime, confirmed_at, deleted_at);
CREATE INDEX idx_care_entries_deviation_type ON care_entries(deviation_type, deleted_at);
CREATE INDEX idx_care_entries_confirmation_suppressed ON care_entries(confirmation_suppressed, status, end_datetime, deleted_at);
CREATE INDEX idx_care_entry_children_child ON care_entry_children(child_id, deleted_at);
CREATE INDEX idx_care_entry_actual_children_child ON care_entry_actual_children(child_id, deleted_at);
CREATE INDEX idx_contact_rules_active ON contact_rules(active, deleted_at, start_date);
CREATE UNIQUE INDEX idx_contact_rules_source_pattern ON contact_rules(source_contact_pattern_id) WHERE source_contact_pattern_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_contact_rule_children_child ON contact_rule_children(child_id, deleted_at);
CREATE INDEX idx_holiday_periods_range ON holiday_periods(start_date, end_date, deleted_at);
CREATE INDEX idx_holiday_periods_external_source ON holiday_periods(source_external_calendar_source_id, source_external_calendar_event_id, deleted_at);
CREATE INDEX idx_unavailable_periods_range ON unavailable_periods(start_datetime, end_datetime, deleted_at);
CREATE INDEX idx_unavailable_periods_duty ON unavailable_periods(duty_related, affects_contact, affects_holidays, deleted_at);
CREATE INDEX idx_unavailable_periods_scope ON unavailable_periods(scope, affects_contact, deleted_at);
CREATE INDEX idx_unavailable_period_children_child ON unavailable_period_children(child_id, deleted_at);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id, timestamp);
CREATE INDEX idx_audit_log_page ON audit_log(timestamp DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_legacy_migration_runs_created ON legacy_migration_runs(created_at DESC);
CREATE INDEX idx_app_users_external_subject ON app_users(external_subject, deleted_at);
CREATE INDEX idx_app_users_role ON app_users(role, deleted_at);
CREATE INDEX idx_native_oidc_login_states_expiry ON native_oidc_login_states(expires_at, consumed_at);
CREATE INDEX idx_native_oidc_sessions_active ON native_oidc_sessions(session_hash, expires_at, revoked_at);
CREATE INDEX idx_native_oidc_sessions_subject ON native_oidc_sessions(external_subject, revoked_at, expires_at);
CREATE INDEX idx_calendar_feed_tokens_user_active ON calendar_feed_tokens(user_id, revoked_at, created_at);
CREATE INDEX idx_calendar_feed_tokens_scope_active ON calendar_feed_tokens(user_id, scope_type, scope_party_id, revoked_at, created_at);
CREATE INDEX idx_recovery_admin_sessions_active ON recovery_admin_sessions(session_hash, expires_at, revoked_at);
CREATE INDEX idx_recovery_admin_sessions_username ON recovery_admin_sessions(username, revoked_at, expires_at);
CREATE INDEX idx_owner_setup_tokens_expiry ON owner_setup_tokens(expires_at, consumed_at);
CREATE UNIQUE INDEX idx_app_memberships_user_active ON app_memberships(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_app_memberships_role_active ON app_memberships(role, deleted_at);
CREATE UNIQUE INDEX idx_user_care_party_assignment_active ON app_user_care_party_assignments(user_id, care_party_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_care_party_assignment_party ON app_user_care_party_assignments(care_party_id, deleted_at);
CREATE UNIQUE INDEX idx_care_confirmation_active_entry_user ON care_confirmation_requests(care_entry_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_care_confirmation_open_user ON care_confirmation_requests(user_id, status, due_at, next_reminder_at, deleted_at);
CREATE UNIQUE INDEX idx_notification_preferences_active ON notification_preferences(user_id, event_type) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_push_subscriptions_active_endpoint ON push_subscriptions(endpoint) WHERE deleted_at IS NULL;
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id, deleted_at);
CREATE INDEX idx_external_calendar_events_range ON external_calendar_events(start_datetime, end_datetime);
CREATE INDEX idx_external_calendar_events_source ON external_calendar_events(source_id);
CREATE INDEX idx_data_transfer_runs_fingerprint ON data_transfer_runs(package_fingerprint, created_at DESC);
CREATE INDEX idx_data_transfer_actors_mapping ON data_transfer_actors(mapped_user_id) WHERE mapped_user_id IS NOT NULL;
CREATE INDEX idx_app_invitations_status ON app_invitations(expires_at, accepted_at, revoked_at, deleted_at);
CREATE INDEX idx_app_invitations_accepted_user ON app_invitations(accepted_user_id) WHERE accepted_user_id IS NOT NULL;
CREATE INDEX idx_app_invitations_transfer_actor ON app_invitations(data_transfer_actor_id) WHERE data_transfer_actor_id IS NOT NULL;
