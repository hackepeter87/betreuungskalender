CREATE TABLE recovery_admin_credentials (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE recovery_admin_sessions (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password_change_required INTEGER NOT NULL DEFAULT 0 CHECK (password_change_required IN (0, 1)),
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_recovery_admin_sessions_active
  ON recovery_admin_sessions(session_hash, expires_at, revoked_at);

CREATE INDEX idx_recovery_admin_sessions_username
  ON recovery_admin_sessions(username, revoked_at, expires_at);
