CREATE TABLE legacy_migration_runs (
  id TEXT PRIMARY KEY,
  source_fingerprint TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('add', 'preview', 'replace')),
  status TEXT NOT NULL CHECK (status IN ('success', 'warning', 'failed')),
  report_json TEXT NOT NULL,
  backup_filename TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_legacy_migration_runs_created
  ON legacy_migration_runs(created_at DESC);
