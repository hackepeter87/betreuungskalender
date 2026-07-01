CREATE TABLE care_parties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (
    kind IN ('father', 'mother', 'grandparent', 'foster_caregiver', 'other')
  ),
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX idx_care_parties_active
  ON care_parties(deleted_at, name);

INSERT INTO care_parties (
  id, name, kind, created_by, updated_by, created_at, updated_at
)
SELECT
  'party_primary',
  'Primary caregiver',
  'other',
  'local-dev',
  'local-dev',
  datetime('now'),
  datetime('now')
WHERE EXISTS (
  SELECT 1 FROM care_entries WHERE deleted_at IS NULL
)
OR EXISTS (
  SELECT 1 FROM contact_rules WHERE deleted_at IS NULL
);

UPDATE care_entries
SET responsible_party_id = 'party_primary'
WHERE responsible_party_id IS NULL
  AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM care_parties WHERE id = 'party_primary');

UPDATE contact_rules
SET responsible_party_id = 'party_primary'
WHERE responsible_party_id IS NULL
  AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM care_parties WHERE id = 'party_primary');
