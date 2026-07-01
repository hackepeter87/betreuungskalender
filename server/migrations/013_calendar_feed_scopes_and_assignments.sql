ALTER TABLE calendar_feed_tokens
  ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'legacy' CHECK (
    scope_type IN ('legacy', 'all', 'party')
  );

ALTER TABLE calendar_feed_tokens
  ADD COLUMN scope_party_id TEXT;

CREATE INDEX idx_calendar_feed_tokens_scope_active
  ON calendar_feed_tokens(user_id, scope_type, scope_party_id, revoked_at, created_at);

CREATE TABLE app_user_care_party_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  care_party_id TEXT NOT NULL REFERENCES care_parties(id),
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE UNIQUE INDEX idx_user_care_party_assignment_active
  ON app_user_care_party_assignments(user_id, care_party_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_user_care_party_assignment_party
  ON app_user_care_party_assignments(care_party_id, deleted_at);
