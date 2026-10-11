ALTER TABLE app_memberships
  ADD COLUMN care_scope_type TEXT NOT NULL DEFAULT 'selected'
  CHECK (care_scope_type IN ('all', 'selected'));

UPDATE app_memberships
SET care_scope_type = 'all'
WHERE role = 'admin'
   OR NOT EXISTS (
     SELECT 1
     FROM app_user_care_party_assignments
     WHERE deleted_at IS NULL
   );

ALTER TABLE app_invitations
  ADD COLUMN care_scope_type TEXT NOT NULL DEFAULT 'selected'
  CHECK (care_scope_type IN ('all', 'selected'));

UPDATE app_invitations
SET care_scope_type = 'all'
WHERE role = 'admin'
   OR NOT EXISTS (
     SELECT 1
     FROM app_user_care_party_assignments
     WHERE deleted_at IS NULL
   );

CREATE TABLE app_invitation_care_party_assignments (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES app_invitations(id),
  care_party_id TEXT NOT NULL REFERENCES care_parties(id),
  created_by TEXT NOT NULL DEFAULT 'local-dev',
  updated_by TEXT NOT NULL DEFAULT 'local-dev',
  created_at TEXT NOT NULL DEFAULT bk_now_iso(),
  updated_at TEXT NOT NULL DEFAULT bk_now_iso(),
  deleted_at TEXT
);

CREATE UNIQUE INDEX idx_invitation_care_party_assignment_active
  ON app_invitation_care_party_assignments(invitation_id, care_party_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_invitation_care_party_assignment_party
  ON app_invitation_care_party_assignments(care_party_id, deleted_at);
