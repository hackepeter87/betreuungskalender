CREATE TABLE app_memberships_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'scheduler', 'viewer')),
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

INSERT INTO app_memberships_v2 (
  id, user_id, role, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT id, user_id,
  CASE role
    WHEN 'admin' THEN 'admin'
    WHEN 'parent' THEN 'editor'
    WHEN 'readonly' THEN 'viewer'
  END,
  created_by, updated_by, created_at, updated_at, deleted_at
FROM app_memberships;

INSERT INTO app_memberships_v2 (
  id, user_id, role, created_by, updated_by, created_at, updated_at
)
SELECT lower(hex(randomblob(16))), users.id,
  CASE users.role
    WHEN 'admin' THEN 'admin'
    WHEN 'parent' THEN 'editor'
    ELSE 'viewer'
  END,
  'migration-v1.19.0', 'migration-v1.19.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM app_users users
WHERE users.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM app_memberships_v2 memberships
    WHERE memberships.user_id = users.id
  );

DROP TABLE app_memberships;
ALTER TABLE app_memberships_v2 RENAME TO app_memberships;

CREATE UNIQUE INDEX idx_app_memberships_user_active
  ON app_memberships(user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_app_memberships_role_active
  ON app_memberships(role, deleted_at);

CREATE TABLE app_invitations_v2 (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email_hint TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'scheduler', 'viewer')),
  expires_at TEXT NOT NULL,
  accepted_user_id TEXT REFERENCES app_users(id),
  accepted_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

INSERT INTO app_invitations_v2 (
  id, token_hash, email_hint, role, expires_at, accepted_user_id, accepted_at,
  revoked_at, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT id, token_hash, email_hint,
  CASE role
    WHEN 'admin' THEN 'admin'
    WHEN 'parent' THEN 'editor'
    WHEN 'readonly' THEN 'viewer'
  END,
  expires_at, accepted_user_id, accepted_at, revoked_at, created_by,
  updated_by, created_at, updated_at, deleted_at
FROM app_invitations;

DROP TABLE app_invitations;
ALTER TABLE app_invitations_v2 RENAME TO app_invitations;

CREATE INDEX idx_app_invitations_status
  ON app_invitations(expires_at, accepted_at, revoked_at, deleted_at);

CREATE INDEX idx_app_invitations_accepted_user
  ON app_invitations(accepted_user_id)
  WHERE accepted_user_id IS NOT NULL;
