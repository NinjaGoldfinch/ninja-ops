-- Add SSH key authentication support to nodes.
-- ssh_auth_method controls which credential is used at connection time.
-- ssh_private_key stores either a PEM-encoded private key or an op:// 1Password
--   secret reference (e.g. op://vault/item/field) — stored encrypted.
-- ssh_key_passphrase is the optional passphrase for encrypted private keys — stored encrypted.
ALTER TABLE nodes
  ADD COLUMN ssh_auth_method  TEXT NOT NULL DEFAULT 'password'
    CHECK (ssh_auth_method IN ('password', 'key')),
  ADD COLUMN ssh_private_key  TEXT,    -- AES-256-GCM encrypted PEM or op:// reference
  ADD COLUMN ssh_key_passphrase TEXT;  -- AES-256-GCM encrypted, nullable
