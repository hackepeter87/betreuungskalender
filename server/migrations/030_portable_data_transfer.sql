CREATE TABLE data_transfer_runs (
  id TEXT PRIMARY KEY,
  package_fingerprint TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  source_version TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('ready', 'warnings', 'imported', 'blocked')),
  counts_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_at TEXT
);

CREATE INDEX idx_data_transfer_runs_fingerprint
  ON data_transfer_runs(package_fingerprint, created_at DESC);

CREATE TABLE data_transfer_actors (
  id TEXT PRIMARY KEY,
  transfer_run_id TEXT NOT NULL REFERENCES data_transfer_runs(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email_hint TEXT,
  suggested_role TEXT CHECK (suggested_role IN ('admin', 'editor', 'scheduler', 'viewer')),
  mapped_user_id TEXT REFERENCES app_users(id),
  invitation_id TEXT REFERENCES app_invitations(id),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(transfer_run_id, source_ref)
);

CREATE INDEX idx_data_transfer_actors_mapping
  ON data_transfer_actors(mapped_user_id)
  WHERE mapped_user_id IS NOT NULL;

CREATE TABLE data_transfer_actor_care_parties (
  actor_id TEXT NOT NULL REFERENCES data_transfer_actors(id) ON DELETE CASCADE,
  source_care_party_id TEXT NOT NULL,
  target_care_party_id TEXT REFERENCES care_parties(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_id, source_care_party_id)
);

ALTER TABLE app_invitations ADD COLUMN data_transfer_actor_id TEXT
  REFERENCES data_transfer_actors(id);

CREATE INDEX idx_app_invitations_transfer_actor
  ON app_invitations(data_transfer_actor_id)
  WHERE data_transfer_actor_id IS NOT NULL;
