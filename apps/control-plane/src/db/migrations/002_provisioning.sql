-- Provisioning jobs track the full lifecycle of a guest creation request
CREATE TABLE provisioning_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  guest_type      TEXT NOT NULL CHECK (guest_type IN ('lxc', 'qemu')),
  vmid            INTEGER NOT NULL,
  name            TEXT NOT NULL,

  -- Proxmox task ID returned when the creation request is accepted
  proxmox_upid    TEXT,

  -- Lifecycle state
  state           TEXT NOT NULL DEFAULT 'pending'
                    CHECK (state IN (
                      'pending',       -- created, not yet submitted to Proxmox
                      'creating',      -- Proxmox task running
                      'starting',      -- waiting for guest to reach running state
                      'deploying',     -- agent deployment in progress (LXC only)
                      'done',          -- success
                      'failed'         -- terminal failure
                    )),

  -- Whether to auto-deploy the agent after provisioning
  deploy_agent    BOOLEAN NOT NULL DEFAULT false,

  -- Full config snapshot (JSON) — the exact params sent to Proxmox
  config          JSONB NOT NULL,

  -- Human-readable error if state = 'failed'
  error_message   TEXT,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX provisioning_jobs_node_id_idx ON provisioning_jobs (node_id);
CREATE INDEX provisioning_jobs_state_idx   ON provisioning_jobs (state);
