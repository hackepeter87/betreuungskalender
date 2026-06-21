CREATE TABLE external_calendar_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  last_imported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE external_calendar_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  ical_uid TEXT NOT NULL,
  recurrence_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT,
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  location TEXT,
  raw_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES external_calendar_sources(id) ON DELETE CASCADE,
  UNIQUE (source_id, ical_uid, recurrence_id)
);

CREATE INDEX idx_external_calendar_events_source
  ON external_calendar_events(source_id);
CREATE INDEX idx_external_calendar_events_range
  ON external_calendar_events(start_datetime, end_datetime);
