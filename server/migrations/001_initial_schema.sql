CREATE TABLE children (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_month INTEGER NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  birth_year INTEGER NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE care_entries (
  id TEXT PRIMARY KEY,
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'completed', 'cancelled')),
  care_scope TEXT NOT NULL CHECK (care_scope IN (
    'overnight', 'full_day', 'half_day', 'hourly', 'evening_care',
    'visit_contact', 'walk_leisure_contact', 'school_ogs_pickup',
    'school_ogs_dropoff', 'appointment_accompaniment', 'other'
  )),
  cancellation_reason TEXT,
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
  deleted_at TEXT
);

CREATE TABLE care_entry_children (
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (care_entry_id, child_id)
);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  purpose TEXT NOT NULL,
  km REAL NOT NULL CHECK (km > 0),
  own_car INTEGER NOT NULL DEFAULT 1 CHECK (own_car IN (0, 1)),
  reimbursed INTEGER NOT NULL DEFAULT 0 CHECK (reimbursed IN (0, 1)),
  reimbursement_amount REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE costs (
  id TEXT PRIMARY KEY,
  care_entry_id TEXT NOT NULL REFERENCES care_entries(id),
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  paid_by TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
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
  deleted_at TEXT
);

CREATE TABLE holiday_period_children (
  holiday_period_id TEXT NOT NULL REFERENCES holiday_periods(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (holiday_period_id, child_id)
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
  deleted_at TEXT
);

CREATE TABLE contact_pattern_children (
  contact_pattern_id TEXT NOT NULL REFERENCES contact_patterns(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (contact_pattern_id, child_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE monthly_closings (
  id TEXT PRIMARY KEY,
  month_key TEXT NOT NULL UNIQUE,
  summary_json TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  changed_after_close_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE INDEX idx_children_active ON children(deleted_at);
CREATE INDEX idx_care_entries_range ON care_entries(start_datetime, end_datetime, deleted_at);
CREATE INDEX idx_care_entries_status ON care_entries(status, deleted_at);
CREATE INDEX idx_care_entry_children_child ON care_entry_children(child_id, deleted_at);
CREATE INDEX idx_holiday_periods_range ON holiday_periods(start_date, end_date, deleted_at);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id, timestamp);
