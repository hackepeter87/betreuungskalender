ALTER TABLE care_entries ADD COLUMN generated_by_pattern_id TEXT;
ALTER TABLE care_entries ADD COLUMN rule_occurrence_date TEXT;
ALTER TABLE care_entries ADD COLUMN custom_location TEXT;

CREATE INDEX idx_care_entries_pattern
  ON care_entries(generated_by_pattern_id, rule_occurrence_date, deleted_at);
