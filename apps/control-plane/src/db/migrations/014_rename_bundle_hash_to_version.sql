-- Migration 012 mistakenly renamed agents.version to bundle_hash; undo that.
-- Conditional so fresh databases (where 012 was never applied) are unaffected.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'bundle_hash'
  ) THEN
    ALTER TABLE agents RENAME COLUMN bundle_hash TO version;
  END IF;
END $$;
