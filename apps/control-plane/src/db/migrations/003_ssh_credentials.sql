-- Add optional SSH credentials to nodes for pct exec fallback on pre-8.1 Proxmox
ALTER TABLE nodes
  ADD COLUMN ssh_user     TEXT NOT NULL DEFAULT 'root',
  ADD COLUMN ssh_password TEXT;          -- nullable; stored AES-256-GCM encrypted
