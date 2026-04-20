-- Full-text search on log line content
CREATE INDEX IF NOT EXISTS log_entries_line_fts_idx
  ON log_entries USING gin(to_tsvector('simple', line));

-- Additional query patterns
CREATE INDEX IF NOT EXISTS log_entries_level_ts_idx  ON log_entries(level, ts DESC);
CREATE INDEX IF NOT EXISTS log_entries_unit_idx      ON log_entries(unit);

-- Saved filters table (per-user, persisted searches)
CREATE TABLE IF NOT EXISTS log_saved_filters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  filter     jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Settings table for runtime configuration (e.g. log retention)
CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);
