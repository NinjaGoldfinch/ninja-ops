-- Add kind column to distinguish deploy-agents from log-agents.
-- The existing unique constraint (node_id, vmid) must become (node_id, vmid, kind)
-- so both agent types can coexist on the same container.

ALTER TABLE agents ADD COLUMN kind TEXT NOT NULL DEFAULT 'deploy'
  CHECK (kind IN ('deploy', 'log'));

ALTER TABLE agents DROP CONSTRAINT agents_node_id_vmid_key;

ALTER TABLE agents ADD CONSTRAINT agents_node_id_vmid_kind_key
  UNIQUE (node_id, vmid, kind);
