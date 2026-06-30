CREATE TABLE app_users (
  id TEXT PRIMARY KEY,
  external_subject TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'parent', 'readonly')),
  groups_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_app_users_external_subject ON app_users(external_subject, deleted_at);
CREATE INDEX idx_app_users_role ON app_users(role, deleted_at);

INSERT INTO app_users (
  id, external_subject, email, display_name, role, groups_json,
  last_seen_at, created_at, updated_at
) VALUES (
  'local-dev',
  'local-dev',
  NULL,
  'local-dev',
  'admin',
  '[]',
  datetime('now'),
  datetime('now'),
  datetime('now')
);
