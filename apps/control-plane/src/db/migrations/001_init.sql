-- Users
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Proxmox nodes
CREATE TABLE nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  host            TEXT NOT NULL,
  port            INTEGER NOT NULL DEFAULT 8006,
  token_id        TEXT NOT NULL,
  token_secret    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'unknown',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deploy targets: maps a repo+branch to a container
CREATE TABLE deploy_targets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository          TEXT NOT NULL,
  branch              TEXT NOT NULL,
  node_id             UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  vmid                INTEGER NOT NULL,
  working_dir         TEXT NOT NULL,
  restart_command     TEXT NOT NULL,
  pre_deploy_command  TEXT,
  post_deploy_command TEXT,
  timeout_seconds     INTEGER NOT NULL DEFAULT 300,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository, branch)
);

-- Deploy jobs
CREATE TABLE deploy_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id     UUID NOT NULL REFERENCES deploy_targets(id) ON DELETE CASCADE,
  trigger       JSONB NOT NULL,
  state         TEXT NOT NULL DEFAULT 'queued'
                  CHECK (state IN ('queued','dispatched','running','success','failed','cancelled')),
  agent_id      UUID,
  queued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  exit_code     INTEGER,
  error_message TEXT
);

CREATE INDEX deploy_jobs_target_id_idx ON deploy_jobs (target_id);
CREATE INDEX deploy_jobs_state_idx ON deploy_jobs (state);

-- Deploy log lines (stdout/stderr streamed from agent)
CREATE TABLE deploy_log_lines (
  id          BIGSERIAL PRIMARY KEY,
  job_id      UUID NOT NULL REFERENCES deploy_jobs(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  stream      TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr')),
  line        TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX deploy_log_lines_job_id_idx ON deploy_log_lines (job_id, seq);

-- Registered agents (one per container)
CREATE TABLE agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id       UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  vmid          INTEGER NOT NULL,
  hostname      TEXT NOT NULL,
  version       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'offline'
                  CHECK (status IN ('idle', 'busy', 'offline')),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, vmid)
);

-- Saved shell commands (per container)
CREATE TABLE saved_commands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id     UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  vmid        INTEGER NOT NULL,
  label       TEXT NOT NULL,
  command     TEXT NOT NULL,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  username      TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  meta          JSONB,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_user_id_idx ON audit_log (user_id);
