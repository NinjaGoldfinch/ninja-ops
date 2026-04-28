# Plan: Container Environment Variable Editor

## Overview

Allow admins to view and edit env files inside managed LXC containers directly from the dashboard. Execution path is unchanged: SSH into the Proxmox host → `pct exec <vmid>`. No new agent capabilities are needed.

**Key requirements:**
- Sensitive variables (keys matching patterns like `*SECRET*`, `*PASSWORD*`, `*TOKEN*`, etc.) are **write-only** — key names are shown, values are never returned to the client.
- Non-sensitive variables show their current value.
- Auto-scan discovers env files at well-known paths and via `find`.
- Users can also pin a specific path manually (stored in DB).
- The UI shows the file path and a human-readable label so it's clear which service owns the file.

---

## Data model

### Migration `015_guest_env_files.sql`

```sql
CREATE TABLE guest_env_files (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id     UUID        NOT NULL,
  vmid        INTEGER     NOT NULL,
  file_path   TEXT        NOT NULL,
  label       TEXT,                       -- e.g. "deploy-agent", "app .env"
  discovered  BOOLEAN     NOT NULL DEFAULT false,  -- true = found by auto-scan
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, vmid, file_path)
);
```

No env values are ever persisted in the database.

---

## packages/types additions (`src/guest-env.ts`)

```typescript
// One entry in an env file — value is null when the key is sensitive
export const EnvEntrySchema = z.object({
  key:       z.string(),
  value:     z.string().nullable(),   // null = sensitive (masked)
  sensitive: z.boolean(),
})

export const GuestEnvFileSchema = z.object({
  id:         z.string().uuid(),
  nodeId:     z.string().uuid(),
  vmid:       z.number().int(),
  filePath:   z.string(),
  label:      z.string().nullable(),
  discovered: z.boolean(),
  createdAt:  z.string().datetime(),
})

export const GuestEnvFileContentsSchema = z.object({
  file:    GuestEnvFileSchema,
  entries: z.array(EnvEntrySchema),
})

// PATCH body — only keys present in the map are updated
export const UpdateEnvVarsSchema = z.object({
  vars: z.record(z.string()),         // { KEY: "new_value" }
})

// POST body for manually adding a file path
export const AddEnvFileSchema = z.object({
  filePath: z.string().min(1),
  label:    z.string().optional(),
})
```

---

## Sensitivity detection

Centralised in `apps/control-plane/src/lib/env-sensitivity.ts`:

```typescript
const SENSITIVE_PATTERNS = [
  /password/i, /passwd/i, /secret/i, /token/i,
  /api_key/i,  /apikey/i, /private_key/i, /privkey/i,
  /auth/i,     /credential/i, /passphrase/i,
  /encryption/i, /signing/i,
]

export function isSensitive(key: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(key))
}
```

---

## Control-plane: service (`src/services/guest-env.ts`)

```
readEnvFile(nodeId, vmid, filePath)
  → pct exec: cat <filePath>
  → parse KEY=VALUE lines (handle comments, blank lines, quoted values)
  → for each entry: isSensitive(key) → value = null, sensitive = true
  → return EnvEntry[]

writeEnvVar(nodeId, vmid, filePath, key, value)
  → pct exec: read file, replace/append the KEY=VALUE line, write back atomically
    using: tmp=$(mktemp) && sed ... > $tmp && mv $tmp <filePath>

scanEnvFiles(nodeId, vmid)
  → pct exec: find well-known dirs + find / -maxdepth 6 -name "*.env" -o -name ".env" 2>/dev/null
  → filter duplicates and noise (node_modules, .git, proc, sys, dev)
  → upsert into guest_env_files with discovered=true
  → return GuestEnvFile[]

listFiles(nodeId, vmid)           → SELECT from guest_env_files
addFile(nodeId, vmid, path, label) → INSERT into guest_env_files (discovered=false)
removeFile(id)                    → DELETE from guest_env_files
```

Well-known paths scanned first (fast path before the `find`):
- `/opt/ninja-agent/.env`
- `/opt/ninja-log-agent/.env`
- The container's deploy target `working_dir + "/.env"` (joined from `deploy_targets` table)
- `/etc/environment`
- `/etc/*.env`

---

## Control-plane: routes (`src/routes/guests/env.ts`)

Registered under `/api/nodes/:nodeId/guests/:vmid/env-files` (admin only).

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/` | List all configured + discovered env files |
| `POST` | `/` | Manually add an env file path |
| `DELETE` | `/:fileId` | Remove a configured path |
| `POST` | `/scan` | Run auto-scan, upsert discovered files, return all |
| `GET`  | `/:fileId/entries` | Read env file contents (sensitive values masked) |
| `PATCH` | `/:fileId/entries` | Update one or more env vars |

All routes require `requireRole('admin')`. SSH errors surface as `AppError.internal()`.

---

## Dashboard

### Hook: `useGuestEnvFiles(nodeId, vmid)`
- `useQuery` → `GET /api/nodes/:nodeId/guests/:vmid/env-files`

### Hook: `useEnvFileEntries(nodeId, vmid, fileId)`
- `useQuery` → `GET .../env-files/:fileId/entries`

### Hook: `useScanEnvFiles(nodeId, vmid)`
- `useMutation` → `POST .../env-files/scan`

### Hook: `useUpdateEnvVars(nodeId, vmid, fileId)`
- `useMutation` → `PATCH .../env-files/:fileId/entries`
- Invalidates `useEnvFileEntries` on success

### Component: `EnvFileList` (`src/components/guests/EnvFileList.tsx`)
- Lists all env files for the container
- Each row: file path + label + "discovered" badge if auto-scanned
- "Scan" button triggers `useScanEnvFiles`
- "Add path" inline form → `POST /env-files`
- Click row → opens `EnvEditor`

### Component: `EnvEditor` (`src/components/guests/EnvEditor.tsx`)
- Table of `KEY → value` pairs
- Sensitive rows: key shown in normal font, value shown as `••••••••` with a pencil icon (clicking opens an edit input, no "reveal" option)
- Non-sensitive rows: value shown inline, click to edit in-place
- Save button per row (or batch save)
- Unsaved changes highlighted in yellow

### Page integration
- Add an **"Environment"** tab to the existing guest detail page (`src/pages/nodes/$nodeId/guests/$vmid.tsx`)
- Tab only visible to admin role

---

## Implementation order

1. `packages/types` — add `src/guest-env.ts`, export from index
2. Migration `015_guest_env_files.sql`
3. `src/lib/env-sensitivity.ts`
4. `src/services/guest-env.ts` — `readEnvFile`, `writeEnvVar`, `scanEnvFiles`, `listFiles`, `addFile`, `removeFile`
5. `src/routes/guests/env.ts` — all 6 routes
6. Register routes in `app.ts`
7. Tests: `src/__tests__/routes/guest-env.test.ts` (mock the proxmox service)
8. Dashboard hooks in `src/hooks/useGuestEnv.ts`
9. `EnvFileList` + `EnvEditor` components
10. Wire into guest detail page as "Environment" tab
11. Version bumps: `packages/types` → `0.2.0`, `control-plane` → `0.2.0`, `dashboard` → patch

---

## Security notes

- **Write-only semantics for sensitive vars**: The control-plane reads the full file to update it, but never includes sensitive values in the HTTP response body. The client can only overwrite a sensitive value, never read it back.
- **Atomicity**: Writes use `mktemp` + `mv` to avoid partial writes leaving a corrupt env file.
- **Shell injection**: All file paths and values written via `pct exec` must go through `shellQuote()` (already in `proxmox.ts`). File path used in `sed` must be validated to be an absolute path before use.
- **Path validation**: Accept only absolute paths starting with `/`. Reject paths containing `..`.
