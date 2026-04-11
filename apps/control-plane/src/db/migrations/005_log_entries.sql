CREATE TABLE log_entries (
  id         BIGSERIAL    PRIMARY KEY,
  vmid       INTEGER      NOT NULL,
  node_id    UUID         NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  source     TEXT         NOT NULL
               CHECK (source IN ('app', 'agent', 'shell', 'system')),
  unit       TEXT,
  level      TEXT         NOT NULL
               CHECK (level IN ('trace', 'debug', 'info', 'warn', 'error', 'fatal')),
  line       TEXT         NOT NULL,
  ts         BIGINT       NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Primary query pattern: tail logs for a container in time order
CREATE INDEX log_entries_vmid_ts    ON log_entries (vmid, ts DESC);

-- Secondary: filter by source/level across the whole system
CREATE INDEX log_entries_node_ts    ON log_entries (node_id, ts DESC);
CREATE INDEX log_entries_source_ts  ON log_entries (source, ts DESC);

-- Purge worker: delete by age
CREATE INDEX log_entries_created    ON log_entries (created_at DESC);
