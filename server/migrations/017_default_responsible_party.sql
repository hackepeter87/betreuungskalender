INSERT OR IGNORE INTO settings (
  key, value_json, created_by, updated_by, created_at, updated_at
)
SELECT
  'defaultResponsiblePartyId',
  json_quote(id),
  'local-dev',
  'local-dev',
  datetime('now'),
  datetime('now')
FROM care_parties
WHERE deleted_at IS NULL
ORDER BY CASE WHEN id = 'party_primary' THEN 0 ELSE 1 END, created_at, id
LIMIT 1;

UPDATE care_entries
SET responsible_party_id = (
  SELECT json_extract(value_json, '$')
  FROM settings
  WHERE key = 'defaultResponsiblePartyId' AND deleted_at IS NULL
)
WHERE responsible_party_id IS NULL
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM settings
    WHERE key = 'defaultResponsiblePartyId' AND deleted_at IS NULL
  );

UPDATE contact_rules
SET responsible_party_id = (
  SELECT json_extract(value_json, '$')
  FROM settings
  WHERE key = 'defaultResponsiblePartyId' AND deleted_at IS NULL
)
WHERE responsible_party_id IS NULL
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM settings
    WHERE key = 'defaultResponsiblePartyId' AND deleted_at IS NULL
  );
