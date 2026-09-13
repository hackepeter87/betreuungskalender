ALTER TABLE native_oidc_login_states
  ADD COLUMN browser_marker_hash TEXT NOT NULL DEFAULT '';
