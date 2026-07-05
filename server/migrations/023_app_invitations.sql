CREATE TABLE app_invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email_hint TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'parent', 'readonly')),
  expires_at TEXT NOT NULL,
  accepted_user_id TEXT REFERENCES app_users(id),
  accepted_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX idx_app_invitations_status
  ON app_invitations(expires_at, accepted_at, revoked_at, deleted_at);

CREATE INDEX idx_app_invitations_accepted_user
  ON app_invitations(accepted_user_id)
  WHERE accepted_user_id IS NOT NULL;
