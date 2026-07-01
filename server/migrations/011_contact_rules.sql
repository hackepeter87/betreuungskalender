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

CREATE INDEX idx_contact_rules_active
  ON contact_rules(active, deleted_at, start_date);

CREATE UNIQUE INDEX idx_contact_rules_source_pattern
  ON contact_rules(source_contact_pattern_id)
  WHERE source_contact_pattern_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE contact_rule_children (
  contact_rule_id TEXT NOT NULL REFERENCES contact_rules(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (contact_rule_id, child_id)
);

CREATE INDEX idx_contact_rule_children_child
  ON contact_rule_children(child_id, deleted_at);

ALTER TABLE care_entries ADD COLUMN contact_rule_id TEXT;
ALTER TABLE care_entries ADD COLUMN contact_rule_segment_id TEXT;
ALTER TABLE care_entries ADD COLUMN contact_rule_occurrence_key TEXT;
ALTER TABLE care_entries ADD COLUMN responsible_party_id TEXT;
ALTER TABLE care_entries ADD COLUMN contact_rule_sync_state TEXT CHECK (
  contact_rule_sync_state IS NULL OR contact_rule_sync_state IN ('generated', 'manual_override')
);

CREATE INDEX idx_care_entries_contact_rule
  ON care_entries(contact_rule_id, contact_rule_occurrence_key, deleted_at);

INSERT INTO contact_rules (
  id, name, start_date, timezone, recurrence_json, segments_json,
  sync_horizon_months, active, source_contact_pattern_id,
  created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  id,
  name,
  start_date,
  'Europe/Berlin',
  json_object('kind', 'weekly', 'intervalWeeks', 2, 'weekdays', json_array('FR')),
  json_array(json_object(
    'id', 'weekend',
    'startDayOffset', 0,
    'startTime', friday_start_time,
    'endDayOffset', 2,
    'endTime', sunday_end_time
  )),
  12,
  active,
  id,
  created_by,
  updated_by,
  created_at,
  updated_at,
  deleted_at
FROM contact_patterns;

INSERT INTO contact_rule_children (
  contact_rule_id, child_id, created_at, updated_at, deleted_at
)
SELECT
  contact_pattern_id,
  child_id,
  created_at,
  updated_at,
  deleted_at
FROM contact_pattern_children;

UPDATE care_entries
SET
  contact_rule_id = generated_by_pattern_id,
  contact_rule_segment_id = 'weekend',
  contact_rule_occurrence_key = rule_occurrence_date || ':weekend',
  contact_rule_sync_state = 'generated'
WHERE generated_by_pattern_id IS NOT NULL
  AND rule_occurrence_date IS NOT NULL
  AND deleted_at IS NULL;
