DROP INDEX IF EXISTS idx_care_entries_range;
DROP INDEX IF EXISTS idx_care_entries_status;
DROP INDEX IF EXISTS idx_care_entries_generated_pattern;
DROP INDEX IF EXISTS idx_care_entries_contact_rule;
DROP INDEX IF EXISTS idx_care_entry_children_child;

ALTER TABLE care_entries RENAME TO care_entries_old;

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
  )
);

INSERT INTO care_entries (
  id, start_datetime, end_datetime, status, care_scope, cancellation_reason,
  overnight, school_handover, holiday, weekend, additional_care, location,
  handover_from, handover_to, notes, evidence_reference, has_evidence,
  duration_minutes, is_contact_time, created_by, updated_by, created_at,
  updated_at, deleted_at, generated_by_pattern_id, rule_occurrence_date,
  custom_location, contact_rule_id, contact_rule_segment_id,
  contact_rule_occurrence_key, responsible_party_id, contact_rule_sync_state
)
SELECT
  id, start_datetime, end_datetime, status, care_scope, cancellation_reason,
  overnight, school_handover, holiday, weekend, additional_care, location,
  handover_from, handover_to, notes, evidence_reference, has_evidence,
  duration_minutes, is_contact_time, created_by, updated_by, created_at,
  updated_at, deleted_at, generated_by_pattern_id, rule_occurrence_date,
  custom_location, contact_rule_id, contact_rule_segment_id,
  contact_rule_occurrence_key, responsible_party_id, contact_rule_sync_state
FROM care_entries_old;

ALTER TABLE care_entry_children RENAME TO care_entry_children_old;

CREATE TABLE care_entry_children (
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (care_entry_id, child_id)
);

INSERT INTO care_entry_children (
  care_entry_id, child_id, created_at, updated_at, deleted_at
)
SELECT care_entry_id, child_id, created_at, updated_at, deleted_at
FROM care_entry_children_old;

DROP TABLE care_entry_children_old;

ALTER TABLE trips RENAME TO trips_old;

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  purpose TEXT NOT NULL,
  km REAL NOT NULL CHECK (km > 0),
  own_car INTEGER NOT NULL DEFAULT 1 CHECK (own_car IN (0, 1)),
  reimbursed INTEGER NOT NULL DEFAULT 0 CHECK (reimbursed IN (0, 1)),
  reimbursement_amount REAL,
  notes TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

INSERT INTO trips (
  id, care_entry_id, purpose, km, own_car, reimbursed,
  reimbursement_amount, notes, created_by, updated_by,
  created_at, updated_at, deleted_at
)
SELECT
  id, care_entry_id, purpose, km, own_car, reimbursed,
  reimbursement_amount, notes, created_by, updated_by,
  created_at, updated_at, deleted_at
FROM trips_old;

DROP TABLE trips_old;

ALTER TABLE costs RENAME TO costs_old;

CREATE TABLE costs (
  id TEXT PRIMARY KEY,
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  paid_by TEXT NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

INSERT INTO costs (
  id, care_entry_id, category, amount, paid_by, notes,
  created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  id, care_entry_id, category, amount, paid_by, notes,
  created_by, updated_by, created_at, updated_at, deleted_at
FROM costs_old;

DROP TABLE costs_old;

DROP TABLE care_entries_old;

CREATE INDEX idx_care_entries_range ON care_entries(start_datetime, end_datetime, deleted_at);
CREATE INDEX idx_care_entries_status ON care_entries(status, deleted_at);
CREATE INDEX idx_care_entry_children_child ON care_entry_children(child_id, deleted_at);
CREATE INDEX idx_care_entries_generated_pattern
  ON care_entries(generated_by_pattern_id, rule_occurrence_date, deleted_at);
CREATE INDEX idx_care_entries_contact_rule
  ON care_entries(contact_rule_id, contact_rule_occurrence_key, deleted_at);
CREATE INDEX idx_care_entries_confirmation
  ON care_entries(status, end_datetime, confirmed_at, deleted_at);

CREATE TABLE care_confirmation_requests (
  id TEXT PRIMARY KEY,
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  user_id TEXT NOT NULL REFERENCES app_users(id),
  due_at TEXT NOT NULL,
  sent_at TEXT,
  answered_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'answered', 'snoozed')) DEFAULT 'open',
  reminder_count INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  next_reminder_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX idx_care_confirmation_active_entry_user
  ON care_confirmation_requests(care_entry_id, user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_care_confirmation_open_user
  ON care_confirmation_requests(user_id, status, due_at, next_reminder_at, deleted_at);

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

CREATE UNIQUE INDEX idx_notification_preferences_active
  ON notification_preferences(user_id, event_type)
  WHERE deleted_at IS NULL;

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

CREATE UNIQUE INDEX idx_push_subscriptions_active_endpoint
  ON push_subscriptions(endpoint)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_push_subscriptions_user
  ON push_subscriptions(user_id, deleted_at);
