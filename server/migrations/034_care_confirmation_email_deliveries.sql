CREATE TABLE care_confirmation_email_deliveries (
  id TEXT PRIMARY KEY,
  care_confirmation_request_id TEXT NOT NULL
    REFERENCES care_confirmation_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('care_confirmation_due', 'care_confirmation_reminder')
  ),
  occurrence_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sent', 'failed')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    attempt_count BETWEEN 0 AND 3
  ),
  next_attempt_at TEXT,
  sent_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(care_confirmation_request_id, event_type, occurrence_key)
);

CREATE INDEX idx_care_confirmation_email_pending
  ON care_confirmation_email_deliveries(status, next_attempt_at, attempt_count);
