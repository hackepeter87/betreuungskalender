CREATE TABLE privacy_action_runs (
  id TEXT PRIMARY KEY,
  preview_fingerprint TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES app_users(id),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'care_party', 'child')),
  action_codes_json TEXT NOT NULL,
  affected_counts_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_privacy_action_runs_idempotency
  ON privacy_action_runs(preview_fingerprint, actor_user_id);

CREATE INDEX idx_privacy_action_runs_actor
  ON privacy_action_runs(actor_user_id, created_at DESC);
