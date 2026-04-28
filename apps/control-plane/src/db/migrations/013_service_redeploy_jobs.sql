CREATE TABLE service_redeploy_jobs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  service        text        NOT NULL CHECK (service IN ('control-plane', 'dashboard')),
  state          text        NOT NULL DEFAULT 'queued'
                             CHECK (state IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  target_version text,
  error_message  text,
  queued_at      timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz
);

CREATE INDEX service_redeploy_jobs_service_idx ON service_redeploy_jobs (service);
CREATE INDEX service_redeploy_jobs_state_idx   ON service_redeploy_jobs (state);

-- One active job per service at a time
CREATE UNIQUE INDEX service_redeploy_jobs_service_active_uniq
  ON service_redeploy_jobs (service)
  WHERE state IN ('queued', 'running');
