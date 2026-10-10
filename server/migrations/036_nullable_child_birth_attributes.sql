-- migration: foreign-keys-off
CREATE TABLE children_with_optional_birth (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_month INTEGER CHECK (birth_month BETWEEN 1 AND 12),
  birth_year INTEGER,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev'
);

INSERT INTO children_with_optional_birth (
  id, name, birth_month, birth_year, color, created_at, updated_at, deleted_at,
  created_by, updated_by
)
SELECT
  id, name, birth_month, birth_year, color, created_at, updated_at, deleted_at,
  created_by, updated_by
FROM children;

DROP TABLE children;
ALTER TABLE children_with_optional_birth RENAME TO children;
CREATE INDEX idx_children_active ON children(deleted_at);
