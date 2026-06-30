CREATE TABLE native_oidc_login_states (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX idx_native_oidc_login_states_expiry
  ON native_oidc_login_states(expires_at, consumed_at);
