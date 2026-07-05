CREATE TABLE app_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'parent', 'readonly')),
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE UNIQUE INDEX idx_app_memberships_user_active
  ON app_memberships(user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_app_memberships_role_active
  ON app_memberships(role, deleted_at);
