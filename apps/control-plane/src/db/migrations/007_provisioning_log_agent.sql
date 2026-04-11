-- Add deploy_log_agent flag to provisioning_jobs so the provisioning pipeline
-- can auto-deploy the log-agent alongside the deploy-agent after container creation.
ALTER TABLE provisioning_jobs
  ADD COLUMN deploy_log_agent BOOLEAN NOT NULL DEFAULT false;
