CREATE TABLE native_oidc_sessions (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  external_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_native_oidc_sessions_active
  ON native_oidc_sessions(session_hash, expires_at, revoked_at);

CREATE INDEX idx_native_oidc_sessions_subject
  ON native_oidc_sessions(external_subject, revoked_at, expires_at);
