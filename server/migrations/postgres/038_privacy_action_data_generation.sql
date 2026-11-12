CREATE TABLE privacy_action_state (
  id TEXT PRIMARY KEY CHECK (id = 'domain'),
  data_generation INTEGER NOT NULL CHECK (data_generation >= 0),
  updated_at TEXT NOT NULL
);

INSERT INTO privacy_action_state (id, data_generation, updated_at)
VALUES ('domain', 0, CURRENT_TIMESTAMP);

ALTER TABLE privacy_action_runs
  ADD COLUMN data_generation INTEGER NOT NULL DEFAULT 0;

DROP INDEX idx_privacy_action_runs_idempotency;

CREATE UNIQUE INDEX idx_privacy_action_runs_idempotency
  ON privacy_action_runs(preview_fingerprint, actor_user_id, data_generation);
