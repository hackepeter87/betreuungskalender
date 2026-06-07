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
  deleted_at TEXT
);

CREATE INDEX idx_unavailable_periods_range
  ON unavailable_periods(start_datetime, end_datetime, deleted_at);
CREATE INDEX idx_unavailable_periods_duty
  ON unavailable_periods(duty_related, affects_contact, affects_holidays, deleted_at);
