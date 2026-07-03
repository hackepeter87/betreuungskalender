ALTER TABLE care_entries ADD COLUMN planned_start_datetime TEXT;
ALTER TABLE care_entries ADD COLUMN planned_end_datetime TEXT;
ALTER TABLE care_entries ADD COLUMN deviation_type TEXT;
ALTER TABLE care_entries ADD COLUMN deviation_note TEXT;

CREATE INDEX idx_care_entries_deviation_type
  ON care_entries(deviation_type, deleted_at);
