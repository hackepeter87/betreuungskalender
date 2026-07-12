ALTER TABLE native_oidc_login_states
  ADD COLUMN context_type TEXT NOT NULL DEFAULT 'normal'
  CHECK (context_type IN ('normal', 'owner_setup', 'invitation'));

ALTER TABLE native_oidc_login_states
  ADD COLUMN context_token_hash TEXT
  CHECK (
    context_token_hash IS NULL
    OR (
      length(context_token_hash) = 64
      AND context_token_hash NOT GLOB '*[^0-9a-f]*'
    )
  );
