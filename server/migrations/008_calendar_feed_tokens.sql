CREATE TABLE calendar_feed_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX idx_calendar_feed_tokens_user_active
  ON calendar_feed_tokens(user_id, revoked_at, created_at);
