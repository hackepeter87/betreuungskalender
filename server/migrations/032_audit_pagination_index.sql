CREATE INDEX IF NOT EXISTS idx_audit_log_page
  ON audit_log(timestamp DESC, id DESC)
  WHERE deleted_at IS NULL;
