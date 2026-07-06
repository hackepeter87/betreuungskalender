INSERT OR IGNORE INTO settings (
  key, value_json, created_by, updated_by, created_at, updated_at
)
SELECT
  'primaryCarePartyId',
  value_json,
  created_by,
  updated_by,
  created_at,
  updated_at
FROM settings
WHERE key = 'defaultResponsiblePartyId'
  AND deleted_at IS NULL
LIMIT 1;

INSERT OR IGNORE INTO settings (
  key, value_json, created_by, updated_by, created_at, updated_at
)
SELECT
  'primaryCarePartyId',
  json_quote(id),
  'local-dev',
  'local-dev',
  datetime('now'),
  datetime('now')
FROM care_parties
WHERE deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM settings WHERE key = 'primaryCarePartyId' AND deleted_at IS NULL
  )
ORDER BY CASE WHEN id = 'party_primary' THEN 0 ELSE 1 END, created_at, id
LIMIT 1;
