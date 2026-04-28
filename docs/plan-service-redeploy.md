# Plan: Self-Redeployment of Control-Plane and Dashboard

## Goal

Allow admins to redeploy the `control-plane` and `dashboard` services from the dashboard UI. The UI should:
- Show the current running version vs the latest available on GitHub
- Show an "update available" badge in the sidebar/taskbar when behind
- Allow one-click redeployment with live log streaming
- Clearly surface errors

---

## Assumptions

- Services run as systemd units on a host accessible via SSH (same pattern as agent redeployment)
- "Latest version" is fetched from GitHub Releases API using the repo defined in env config
- "Current version" is read from `package.json` at build time and exposed via a new API endpoint
- Redeployment = SSH into host → `git fetch && git reset --hard <tag/sha>` → `pnpm install --frozen-lockfile` → `systemctl restart <unit>`
- The GitHub repo is the same repo this monorepo lives in (or configurable via env)

---

## Phase 1 — Shared Types (`packages/types`)

### New file: `packages/types/src/service-redeploy.ts`

```typescript
import { z } from 'zod'

export const SERVICE_NAMES = ['control-plane', 'dashboard'] as const
export const ServiceNameSchema = z.enum(SERVICE_NAMES)
export type ServiceName = z.infer<typeof ServiceNameSchema>

export const SERVICE_REDEPLOY_STATES = ['queued', 'running', 'success', 'failed', 'cancelled'] as const
export const ServiceRedeployStateSchema = z.enum(SERVICE_REDEPLOY_STATES)
export type ServiceRedeployState = z.infer<typeof ServiceRedeployStateSchema>

export const ServiceVersionSchema = z.object({
  service: ServiceNameSchema,
  current: z.string(),           // semver from running package.json
  latest: z.string(),            // latest GitHub release tag
  latestSha: z.string(),         // commit SHA of latest release
  updateAvailable: z.boolean(),
  checkedAt: z.string(),         // ISO timestamp of last GitHub check
})
export type ServiceVersion = z.infer<typeof ServiceVersionSchema>

export const ServiceRedeployJobSchema = z.object({
  id: z.string().uuid(),
  service: ServiceNameSchema,
  state: ServiceRedeployStateSchema,
  targetVersion: z.string().optional(),   // tag/sha to deploy, null = latest
  errorMessage: z.string().optional(),
  queuedAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
})
export type ServiceRedeployJob = z.infer<typeof ServiceRedeployJobSchema>

export const EnqueueServiceRedeploySchema = z.object({
  service: ServiceNameSchema,
  targetVersion: z.string().optional(),   // if omitted, use latest
})
export type EnqueueServiceRedeploy = z.infer<typeof EnqueueServiceRedeploySchema>
```

### Update `packages/types/src/index.ts`

Export all new symbols from `service-redeploy.ts`.

---

## Phase 2 — Database Migration

### New table: `service_redeploy_jobs`

```sql
-- migrations/XXXX_service_redeploy_jobs.sql
CREATE TABLE service_redeploy_jobs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  service      text        NOT NULL CHECK (service IN ('control-plane', 'dashboard')),
  state        text        NOT NULL DEFAULT 'queued'
                           CHECK (state IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  target_version text,
  error_message text,
  queued_at    timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

CREATE INDEX service_redeploy_jobs_service_idx ON service_redeploy_jobs (service);
CREATE INDEX service_redeploy_jobs_state_idx   ON service_redeploy_jobs (state);
```

Logs are stored in the existing `job_sessions` / `job_session_logs` tables (same pattern as agent redeploy) — no new log table needed.

---

## Phase 3 — Control-Plane: Version Service

### New file: `apps/control-plane/src/services/service-versions.ts`

Responsibilities:
- Read own current version from `apps/control-plane/package.json` at startup
- Read dashboard current version from `apps/dashboard/package.json` at startup  
- Poll GitHub Releases API every N minutes (configurable, default 30 min)
- Cache result in memory; expose via `getServiceVersions()`

```typescript
interface ServiceVersionCache {
  'control-plane': ServiceVersion
  'dashboard': ServiceVersion
}

let cache: ServiceVersionCache | null = null

export async function getServiceVersions(): Promise<ServiceVersionCache>

async function fetchLatestGithubRelease(repo: string): Promise<{ tag: string; sha: string }>
// GET https://api.github.com/repos/{repo}/releases/latest
// Uses GITHUB_TOKEN env var for auth (avoids rate limiting)
// Falls back to /git/refs/tags if releases unavailable

export function startVersionPoller(intervalMs = 30 * 60 * 1000): NodeJS.Timer
```

**Env vars required:**

```
GITHUB_REPO=NinjaGoldfinch/ninja-ops   # or whatever the repo is
GITHUB_TOKEN=ghp_...                    # PAT with read:packages scope
```

---

## Phase 4 — Control-Plane: Redeploy Service

### New file: `apps/control-plane/src/services/service-redeploy.ts`

```typescript
export class ServiceRedeployService {
  async enqueue(input: EnqueueServiceRedeploy): Promise<ServiceRedeployJob>
    // 1. Fetch latest version if targetVersion omitted
    // 2. INSERT into service_redeploy_jobs
    // 3. getServiceRedeployQueue().add(jobId)
    // 4. Return job

  async listJobs(filter: { service?: ServiceName; limit?: number }): Promise<ServiceRedeployJob[]>

  async getJob(id: string): Promise<ServiceRedeployJob>

  async cancel(id: string): Promise<ServiceRedeployJob>
    // Only if state === 'queued'; transitions to 'cancelled'
}
```

### New file: `apps/control-plane/src/workers/service-redeploy-runner.ts`

Executes the actual SSH-based deployment:

```typescript
async function runServiceRedeployJob(jobId: string): Promise<void> {
  const job = await db.getServiceRedeployJob(jobId)
  const logger = new JobSessionLogger('service_redeploy', jobId)

  await transition(jobId, 'running', { startedAt: new Date() })
  broadcastServiceRedeployUpdate(job)

  try {
    const host = getDeploymentHost()   // from env: SELF_DEPLOY_HOST
    const unit = SERVICE_UNITS[job.service]  // e.g. 'ninja-control-plane'
    const workDir = SERVICE_WORK_DIRS[job.service]

    await sshExec(host, [
      `cd ${workDir}`,
      `git fetch origin`,
      `git reset --hard ${job.targetVersion}`,
      `pnpm install --frozen-lockfile`,
      `pnpm build --filter=${job.service}`,
      `systemctl restart ${unit}`,
    ], { logger })

    await transition(jobId, 'success', { finishedAt: new Date() })
  } catch (err) {
    await transition(jobId, 'failed', { finishedAt: new Date(), errorMessage: err.message })
    throw err
  } finally {
    broadcastServiceRedeployUpdate(await db.getServiceRedeployJob(jobId))
  }
}
```

**Env vars required:**

```
SELF_DEPLOY_HOST=192.168.1.x     # SSH host for the machine running these services
SELF_DEPLOY_SSH_KEY=/path/to/key  # SSH private key path
SERVICE_CONTROL_PLANE_UNIT=ninja-control-plane
SERVICE_DASHBOARD_UNIT=nginx      # or whatever serves the dashboard
SERVICE_CONTROL_PLANE_DIR=/opt/ninja-ops
SERVICE_DASHBOARD_DIR=/opt/ninja-ops
```

> **Note on control-plane self-restart:** When control-plane redeploys itself, the process will die mid-job. The worker must enqueue a "finish" sentinel (a DB row updated to success) before issuing `systemctl restart`, and the new process picks up the already-completed job state on startup. Alternatively: delegate control-plane restarts to an external watchdog/agent. This is the main tricky edge case — document the chosen approach clearly.

---

## Phase 5 — Control-Plane: Routes

### New file: `apps/control-plane/src/routes/services/index.ts`

```
GET  /api/services/versions                    → { 'control-plane': ServiceVersion, dashboard: ServiceVersion }
POST /api/services/:service/redeploy           → ServiceRedeployJob   (admin only)
GET  /api/services/redeploy-jobs               → ServiceRedeployJob[] (admin only, ?service=X&limit=N)
GET  /api/services/redeploy-jobs/:jobId        → ServiceRedeployJob   (admin only)
POST /api/services/redeploy-jobs/:jobId/cancel → ServiceRedeployJob   (admin only)
GET  /api/services/redeploy-jobs/:jobId/logs   → JobSessionLog[]      (admin only)
```

All routes follow the existing `{ ok: true, data: T }` / `{ ok: false, code, message }` envelope.

Register in `apps/control-plane/src/router.ts` under `/api/services`.

---

## Phase 6 — WebSocket: Real-time Updates

In `apps/control-plane/src/session.ts`, add:

```typescript
broadcastServiceRedeployUpdate(job: ServiceRedeployJob): void
// Sends { type: 'service_redeploy_update', data: job } to all admin sessions

broadcastServiceVersionUpdate(versions: ServiceVersionCache): void
// Sends { type: 'service_version_update', data: versions } to all sessions
// Called after each GitHub poll cycle
```

Clients do not need to subscribe — all admins receive updates passively (same as `redeploy_update` for agents).

---

## Phase 7 — Dashboard: Hooks

### New file: `apps/dashboard/src/hooks/useServiceRedeploy.ts`

```typescript
export function useServiceVersions()
  // GET /api/services/versions — refetch every 5 min as fallback polling
  // Also updates on 'service_version_update' WS message

export function useRedeployService()
  // mutation: POST /api/services/:service/redeploy
  // invalidates useServiceVersions + useServiceRedeployJobs on success

export function useServiceRedeployJobs(service?: ServiceName)
  // GET /api/services/redeploy-jobs?service=X

export function useServiceRedeployJob(jobId: string | null)
  // GET /api/services/redeploy-jobs/:jobId
  // refetchInterval: 2000ms while state in ['queued', 'running']

export function useCancelServiceRedeploy()
  // mutation: POST /api/services/redeploy-jobs/:jobId/cancel

export function useServiceRedeployLiveUpdates()
  // listens on WS for 'service_redeploy_update' and 'service_version_update'
  // calls queryClient.setQueryData to update cache in-place
```

---

## Phase 8 — Dashboard: Components

### New file: `apps/dashboard/src/components/services/ServiceRedeployDrawer.tsx`

Mirrors the existing `RedeployDrawer.tsx` for agents. Shows:
- Service name + target version
- Job state with colored pill (queued → yellow, running → blue, success → green, failed → red)
- Timestamps (queued at, started at, finished at, duration)
- Error message section (shown when `state === 'failed'`)
- Scrollable log viewer (uses existing `DeployLogViewer` or similar)
- Cancel button (shown when `state === 'queued'`)

### New file: `apps/dashboard/src/components/services/ServiceVersionCard.tsx`

Compact card showing one service:
- Service name
- Current version badge + latest available badge
- "Up to date" / "Update available" indicator
- "Deploy latest" button (disabled if job already queued/running)
- "Advanced" dropdown to pick a specific version/tag

---

## Phase 9 — Dashboard: Services Page

### New file: `apps/dashboard/src/pages/services/index.tsx`

Route: `/services`

Layout:
```
┌─────────────────────────────────────────────────────┐
│ Services                                            │
├────────────────────┬────────────────────────────────┤
│ control-plane      │ dashboard                      │
│ current: 1.4.2     │ current: 1.4.2                 │
│ latest:  1.5.0 ↑   │ latest:  1.5.0 ↑              │
│ [Deploy latest]    │ [Deploy latest]               │
├────────────────────┴────────────────────────────────┤
│ Recent Redeploy Jobs                                │
│ ┌──────┬──────────────┬──────────┬────────────────┐ │
│ │ Svc  │ Version      │ State    │ Started        │ │
│ ├──────┼──────────────┼──────────┼────────────────┤ │
│ │ cp   │ v1.5.0       │ success  │ 2 min ago      │ │
│ │ dash │ v1.5.0       │ running  │ just now   [▶] │ │
│ └──────┴──────────────┴──────────┴────────────────┘ │
└─────────────────────────────────────────────────────┘
```

Clicking a job row opens `ServiceRedeployDrawer` with live logs.

Register route in `apps/dashboard/src/router.ts` (add to sidebar nav, admin-only).

---

## Phase 10 — Sidebar: Update Available Badge

In `apps/dashboard/src/components/layout/Sidebar.tsx` (or equivalent nav component):

- Call `useServiceVersions()` in the layout component
- If either service has `updateAvailable: true`, show a yellow dot / "Updates available" badge on the Services nav item
- Tooltip: "control-plane v1.5.0 available" / "dashboard v1.5.0 available"

This gives the persistent taskbar indicator requirement.

---

## Phase 11 — Tests

For each new schema in `packages/types`:
- At least one `parse` test (valid input)
- At least one `safeParse` test (invalid input, check error shape)

File: `packages/types/src/__tests__/service-redeploy.test.ts`

---

## Implementation Order

1. `packages/types` — schemas + exports + tests
2. Database migration — run + verify
3. `service-versions.ts` — GitHub polling service
4. `service-redeploy.ts` — service + DB helpers
5. `service-redeploy-runner.ts` — BullMQ worker
6. Routes (`/api/services/*`)
7. WebSocket broadcast additions
8. Dashboard hooks (`useServiceRedeploy.ts`)
9. Dashboard components (`ServiceRedeployDrawer`, `ServiceVersionCard`)
10. Dashboard page (`/services`)
11. Sidebar update badge
12. `pnpm typecheck` — verify no breakage
13. Manual smoke test

---

## Open Questions

1. **Control-plane self-restart:** The running process cannot complete a job after `systemctl restart` kills it. Options:
   - a) Mark job `success` before issuing restart (optimistic — loses error detection)
   - b) Delegate via a separate "watchdog" script that restarts and then writes a sentinel file checked on next startup
   - c) Use the existing `deploy-agent` on the host machine to handle the restart (cleanest, reuses existing infra)

2. **GitHub token scope:** A PAT with `contents:read` is sufficient for public repos. For private repos, ensure `GITHUB_TOKEN` is in env and rotated appropriately.

3. **Dashboard static rebuild:** Redeploying the dashboard likely means rebuilding the React app and putting dist/ somewhere nginx can serve it. The systemd "restart" step needs to be `pnpm build && cp -r dist/ /var/www/html/` not just a process restart. Clarify deploy script before implementation.

4. **Rollback:** Not scoped in this plan. Could be a follow-up: keep last 3 builds and add a "rollback" button per service.
