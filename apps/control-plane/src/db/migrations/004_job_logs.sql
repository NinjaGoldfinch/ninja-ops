-- Job log storage: persists stdout/stderr from agent deploys and provisioning jobs
CREATE TABLE job_logs (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT        NOT NULL,  -- unique per run (UUID)
  job_type    TEXT        NOT NULL,  -- 'agent_deploy' | 'provisioning'
  job_id      TEXT        NOT NULL,  -- nodeId/vmid composite or provisioning job UUID
  stream      TEXT        NOT NULL,  -- 'stdout' | 'stderr'
  data        TEXT        NOT NULL,
  ts          BIGINT      NOT NULL,  -- unix ms
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX job_logs_session  ON job_logs (session_id, created_at);
CREATE INDEX job_logs_job      ON job_logs (job_type, job_id, created_at);

-- Auto-purge entries older than 30 days (run by a maintenance job or pg_cron)
-- For now just an index to support future cleanup
CREATE INDEX job_logs_created  ON job_logs (created_at);
