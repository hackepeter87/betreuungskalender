ALTER TABLE children ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local-dev';
ALTER TABLE children ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE trips ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local-dev';
ALTER TABLE trips ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE costs ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local-dev';
ALTER TABLE costs ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE holiday_periods ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local-dev';
ALTER TABLE holiday_periods ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE contact_patterns ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local-dev';
ALTER TABLE contact_patterns ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE settings ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local-dev';
ALTER TABLE settings ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local-dev';

ALTER TABLE monthly_closings ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local-dev';
UPDATE monthly_closings
SET updated_by = closed_by
WHERE updated_by = 'local-dev';
