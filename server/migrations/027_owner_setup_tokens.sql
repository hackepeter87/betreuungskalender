CREATE TABLE owner_setup_tokens (
  token_hash TEXT PRIMARY KEY
    CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_by TEXT REFERENCES app_users(id)
);

CREATE INDEX idx_owner_setup_tokens_expiry
  ON owner_setup_tokens(expires_at, consumed_at);
