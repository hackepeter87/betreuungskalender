ALTER TABLE care_entries
  ADD COLUMN confirmation_suppressed INTEGER NOT NULL DEFAULT 0
  CHECK (confirmation_suppressed IN (0, 1));

CREATE INDEX idx_care_entries_confirmation_suppressed
  ON care_entries(confirmation_suppressed, status, end_datetime, deleted_at);
