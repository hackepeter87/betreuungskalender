ALTER TABLE external_calendar_sources
  ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'file'
  CHECK (source_kind IN ('file', 'url'));

ALTER TABLE external_calendar_sources
  ADD COLUMN feed_url TEXT;

ALTER TABLE external_calendar_sources
  ADD COLUMN last_refresh_at TEXT;

ALTER TABLE external_calendar_sources
  ADD COLUMN last_refresh_error TEXT;
