CREATE TABLE agent_redeploy_jobs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  state         text        NOT NULL DEFAULT 'queued',
  error_message text,
  queued_at     timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

CREATE INDEX agent_redeploy_jobs_agent_queued_idx
  ON agent_redeploy_jobs(agent_id, queued_at DESC);

-- Prevents double-enqueue: only one active job per agent at a time
CREATE UNIQUE INDEX agent_redeploy_jobs_agent_active_uniq
  ON agent_redeploy_jobs(agent_id)
  WHERE state IN ('queued', 'running');
