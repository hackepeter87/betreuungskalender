ALTER TABLE unavailable_periods
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'own_unavailability'
    CHECK (scope IN ('own_unavailability', 'external_contact_block'));

ALTER TABLE unavailable_periods
  ADD COLUMN responsible_party_id TEXT REFERENCES care_parties(id);

CREATE TABLE unavailable_period_children (
  unavailable_period_id TEXT NOT NULL REFERENCES unavailable_periods(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (unavailable_period_id, child_id)
);

CREATE INDEX idx_unavailable_periods_scope
  ON unavailable_periods(scope, affects_contact, deleted_at);

CREATE INDEX idx_unavailable_period_children_child
  ON unavailable_period_children(child_id, deleted_at);
