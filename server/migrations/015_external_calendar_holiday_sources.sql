ALTER TABLE external_calendar_sources
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'overlay'
  CHECK (source_type IN ('overlay', 'holiday'));

ALTER TABLE holiday_periods
  ADD COLUMN source_external_calendar_source_id TEXT;

ALTER TABLE holiday_periods
  ADD COLUMN source_external_calendar_event_id TEXT;

CREATE INDEX idx_holiday_periods_external_source
  ON holiday_periods(source_external_calendar_source_id, source_external_calendar_event_id, deleted_at);
