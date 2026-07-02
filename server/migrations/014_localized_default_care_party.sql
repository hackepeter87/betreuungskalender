UPDATE care_parties
SET name = 'Hauptbetreuung',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'party_primary'
  AND name = 'Primary caregiver'
  AND kind = 'other'
  AND deleted_at IS NULL;
