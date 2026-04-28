# Plan — Agent Redeployment + Update Visibility + Per-Node Queue

## Context

`deploy-agent` and `log-agent` are bundled and shipped to LXCs once at provisioning time (`deployAgentIntoLxc` / `deployLogAgentIntoLxc` in `apps/control-plane/src/services/agent-deployer.ts`). After that, there is no mechanism to push new agent code, no signal that an agent is running an outdated version, and no concurrency control to keep concurrent installs from colliding on `dpkg`/systemd locks when multiple LXCs on the same Proxmox node are updated together.

This plan adds:
1. An idempotent **redeploy** flow (single + bulk) that reuses the existing deployer functions.
2. A **bundle-version comparison** so the dashboard can flag agents whose running version is older than the bundle on disk.
3. A **per-Proxmox-node mutex** (Redis SETNX) inside a new BullMQ queue so cross-node redeploys run in parallel but same-node redeploys serialize.

The agent version is currently hardcoded to `0.1.0` in both agents — fixing that is part of this work (esbuild `define` from `package.json`).

## Design decisions (locked in)

- **Queue**: new BullMQ queue `agent-redeploy`, single worker file (matches "one file per queue" rule), `concurrency: 5`. Inside the processor, attempt `SET NX EX 1800 redeploy:node:<nodeId> <jobId>`. On miss, throw a retryable error and let BullMQ requeue with `attempts: 60, backoff: { type: 'fixed', delay: 5000 }`. Always `DEL` the lock in `finally`. TTL (30 min) is the safety net for crash-leaked locks.
- **Version source**: esbuild `define: { __AGENT_VERSION__: JSON.stringify(pkg.version) }` injected at bundle build time. Bundle layout stays a single `index.js` — no tar changes.
- **"Needs update" computation**: derived at API time (no DB column). Control-plane reads `apps/deploy-agent/package.json` and `apps/log-agent/package.json` once at boot. New endpoint `GET /api/agents/bundle-info` returns `{ deployAgentVersion, logAgentVersion }`. Dashboard compares per-row, by `agent.kind`. Don't semver-compare — exact-mismatch is the rule (bundle is source of truth, may roll backward intentionally).
- **Job table**: new `agent_redeploy_jobs`. Reuse existing `JobLogger` (`apps/control-plane/src/services/job-logger.ts`) with `jobType: 'agent_redeploy'` — no new logs table.
- **Concurrent-enqueue guard**: partial unique index on `(agent_id) WHERE state IN ('queued','running')` so a double-click returns `AppError.conflict` instead of double-deploying.
- **Cancel scope**: only `queued` jobs can be cancelled (remove from BullMQ + transition state). Cancelling a `running` `pct exec` is out of scope.

## Files to add

- `packages/types/src/agent-redeploy.ts` — `AgentRedeployStateSchema` (`queued|running|success|failed|cancelled`), `AgentRedeployJobSchema`, `EnqueueAllRequestSchema` (`{ kind?: AgentKind, onlyOutdated?: boolean }`), `BundleInfoSchema`. Re-export from `packages/types/src/index.ts`.
- `apps/control-plane/src/db/migrations/011_agent_redeploy_jobs.sql` — table `agent_redeploy_jobs(id uuid pk, agent_id uuid fk → agents on delete cascade, state text, error_message text, queued_at timestamptz default now(), started_at timestamptz, finished_at timestamptz)`. Index `(agent_id, queued_at desc)`. Partial unique index on `agent_id WHERE state IN ('queued','running')`.
- `apps/control-plane/src/services/bundle-versions.ts` — reads both agent `package.json` files at module load; exports `getBundleVersions()`.
- `apps/control-plane/src/services/agent-redeploy.ts` — `AgentRedeployService` with `enqueueOne(agentId)`, `enqueueAll({ kind?, onlyOutdated? })` (uses `queue.addBulk` + single DB transaction), `listJobs(filter)`, `getJob(id)`, `cancel(id)`, `transition(id, state, extra?)`. All errors are `AppError`. Broadcasts via `sessionManager`.
- `apps/control-plane/src/workers/agent-redeploy-runner.ts` — Queue + Worker pair, mirrors `provisioning-runner.ts`. Acquires per-node Redis lock; resolves `agent.kind` and calls `deployAgentIntoLxc` or `deployLogAgentIntoLxc` with a `JobLogger('agent_redeploy', jobId)`; releases lock in `finally`.
- `apps/control-plane/src/routes/agents/redeploy.ts` — sub-route file mounted from `routes/agents/index.ts`. Endpoints (all `requireRole('admin')` except bundle-info which is operator+):
  - `POST /api/agents/:agentId/redeploy`
  - `POST /api/agents/redeploy-all` (body: `{ kind?, onlyOutdated? }`)
  - `POST /api/agents/redeploy-jobs/:jobId/cancel`
  - `GET  /api/agents/redeploy-jobs?agentId=&limit=`
  - `GET  /api/agents/redeploy-jobs/:jobId`
  - `GET  /api/agents/bundle-info`
- `apps/dashboard/src/hooks/useAgentRedeploy.ts` — TanStack Query hooks: `useBundleInfo`, `useRedeployAgent`, `useRedeployAll`, `useRedeployJobs`, `useRedeployJob`, `useCancelRedeploy`. Mutations invalidate `['agents']` + `['agent-redeploy-jobs']`.
- `apps/dashboard/src/components/agents/RedeployDrawer.tsx` — drawer showing live job state and streamed `job_logs` for the active redeploy.

## Files to modify

- `packages/types/src/websocket.ts` — add `redeploy_update` server-to-client variant carrying `AgentRedeployJob`.
- `packages/types/src/index.ts` — re-export new schemas.
- `apps/deploy-agent/src/register.ts` — replace `const VERSION = '0.1.0'` with `declare const __AGENT_VERSION__: string; const VERSION = __AGENT_VERSION__`.
- `apps/log-agent/src/register.ts` — same change.
- `scripts/package-agent.mjs` and `scripts/package-log-agent.mjs` — add `define: { __AGENT_VERSION__: JSON.stringify(pkg.version) }` to the esbuild call (read the agent's `package.json` from disk in the script). Log the version being packaged.
- `apps/control-plane/src/routes/agents/index.ts` — register the new redeploy sub-route.
- `apps/control-plane/src/index.ts` (boot) — `await startAgentRedeployWorker()`; on shutdown call `stopAgentRedeployWorker()`.
- `apps/control-plane/src/ws/session.ts` — add `broadcastRedeployUpdate(job)` mirroring `broadcastProvisioningUpdate`.
- `apps/dashboard/src/pages/agents/index.tsx` — add "Update available" badge in the version column (compare `agent.version` to bundle version for that `kind`); per-row "Redeploy" button (admin only); header "Redeploy outdated" button; subscribe to `redeploy_update` WS messages.
- `apps/dashboard/src/lib/ws.ts` (or wherever WS messages are dispatched) — handle `redeploy_update`.

## Implementation order

1. Types — `agent-redeploy.ts` + websocket addition + index re-exports. `pnpm typecheck`.
2. Migration `011`.
3. Bundle-version plumbing — esbuild `define` in both bundle scripts; update both `register.ts`; add `bundle-versions.ts`; rebuild bundles via existing `pnpm package:agent` / `package:log-agent`.
4. Service `agent-redeploy.ts`.
5. Worker `agent-redeploy-runner.ts`.
6. WS broadcast helper.
7. Routes + boot wiring.
8. Integration test (control-plane) — happy path, viewer 403, double-enqueue conflict.
9. Dashboard hooks → page changes → drawer.
10. Manual end-to-end verification (below).

## Verification

1. Bump `apps/deploy-agent/package.json` to `0.2.0`. Run `pnpm package:agent`. Restart control-plane.
2. `GET /api/agents/bundle-info` → `{ deployAgentVersion: '0.2.0', logAgentVersion: ... }`.
3. Existing agents still report `0.1.0`; dashboard shows "Update available" badge on `deploy`-kind rows.
4. Click **Redeploy** on one agent → drawer opens, job goes `queued`→`running`→`success`, logs stream live, agent reconnects on `0.2.0`, badge clears.
5. Click **Redeploy outdated** with two agents on the same Proxmox node and one on a different node → confirm via control-plane logs that the same-node pair serializes (~5s retry delay) while the cross-node job runs in parallel.
6. Force a failure (stop the LXC mid-run) → job transitions `failed` with `errorMessage`; confirm Redis `redeploy:node:<nodeId>` key is gone (lock released), and a fresh redeploy succeeds without restarting control-plane.
7. Viewer-role token gets `403` on POST routes; `GET /bundle-info` works.
8. Double-click Redeploy on the same agent while one is queued → second click returns `AppError.conflict` (HTTP 409).

## Critical files (already exist — reuse, don't reinvent)

- `apps/control-plane/src/services/agent-deployer.ts` — `deployAgentIntoLxc`, `deployLogAgentIntoLxc` (already idempotent).
- `apps/control-plane/src/workers/provisioning-runner.ts` — Queue+Worker pattern to mirror.
- `apps/control-plane/src/services/job-logger.ts` — `JobLogger`.
- `apps/control-plane/src/services/agent.ts` — `agentService.listAgents`, status broadcasts.
- `apps/control-plane/src/services/node.ts` — `nodeService.getWithSecret` for SSH config.
- `apps/control-plane/src/db/redis.ts` — `bullmqConnection` for queues; same client for SETNX.
- `apps/control-plane/src/ws/session.ts` — `sessionManager` broadcasts.
- `apps/dashboard/src/pages/agents/index.tsx` — current agents table.

## Edge cases / gotchas

- **Lock leakage on worker SIGKILL** — TTL of 1800s is the recovery floor. Document.
- **Agent reconnect race** — redeploy runs from the control plane (not from the agent's own WS), so `systemctl restart` killing the agent does NOT abort the BullMQ job. Confirm `markDisconnected` doesn't cascade into anything that fails the job.
- **`onlyOutdated` semantics** — exact-string mismatch only; do not semver-compare.
- **Bulk enqueue atomicity** — wrap inserts and `queue.addBulk` in a single DB transaction.
- **Cancel of running job** — explicitly out of scope; surface a UI hint if user clicks cancel on a running row.
- **Non-LXC agents** — agents only exist for LXC today; no QEMU branch needed. Add an explicit guard in the worker that throws if the underlying guest type is not LXC, in case that changes later.
