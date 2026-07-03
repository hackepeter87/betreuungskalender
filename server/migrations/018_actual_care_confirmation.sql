ALTER TABLE care_entries ADD COLUMN actual_start_datetime TEXT;
ALTER TABLE care_entries ADD COLUMN actual_end_datetime TEXT;
ALTER TABLE care_entries ADD COLUMN actual_responsible_party_id TEXT;

CREATE TABLE care_entry_actual_children (
  care_entry_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  PRIMARY KEY (care_entry_id, child_id)
);

CREATE INDEX idx_care_entry_actual_children_child
  ON care_entry_actual_children(child_id, deleted_at);
