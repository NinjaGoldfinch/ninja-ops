-- Indexes spec'd in the original plan but missed in 009
CREATE INDEX IF NOT EXISTS log_entries_vmid_ts_idx ON log_entries(vmid,    ts DESC);
CREATE INDEX IF NOT EXISTS log_entries_node_ts_idx ON log_entries(node_id, ts DESC);
