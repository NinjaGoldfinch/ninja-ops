import { sql } from '../db/client.js'
import { AppError } from '../errors.js'
import { sessionManager } from '../ws/session.js'
import { getBundleVersions } from './bundle-versions.js'
import { getAgentRedeployQueue } from '../workers/agent-redeploy-runner.js'
import type { AgentRedeployJob, AgentRedeployState, EnqueueAllRequest, AgentKind } from '@ninja/types'

// ── DB row types ──────────────────────────────────────────────────────────

interface DbRedeployJob {
  id: string
  agent_id: string
  state: string
  error_message: string | null
  queued_at: Date
  started_at: Date | null
  finished_at: Date | null
}

interface DbAgentRow {
  id: string
  node_id: string
  kind: string
  bundle_hash: string
}

function toJob(row: DbRedeployJob): AgentRedeployJob {
  return {
    id: row.id,
    agentId: row.agent_id,
    state: row.state as AgentRedeployState,
    errorMessage: row.error_message,
    queuedAt: row.queued_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  }
}

// ── Service ───────────────────────────────────────────────────────────────

export class AgentRedeployService {
  async enqueueOne(agentId: string): Promise<AgentRedeployJob> {
    // Guard: agent must exist
    const agents = await sql<DbAgentRow[]>`SELECT id FROM agents WHERE id = ${agentId}`
    if (!agents[0]) throw AppError.notFound('Agent')

    let row: DbRedeployJob
    try {
      const rows = await sql<DbRedeployJob[]>`
        INSERT INTO agent_redeploy_jobs (agent_id)
        VALUES (${agentId})
        RETURNING *
      `
      row = rows[0]!
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict('A redeploy is already queued or running for this agent')
      }
      throw err
    }

    await getAgentRedeployQueue().add('redeploy', { jobId: row.id }, {
      attempts: 60,
      backoff: { type: 'fixed', delay: 5000 },
    })
    const job = toJob(row)
    sessionManager.broadcastRedeployUpdate(job)
    return job
  }

  async enqueueAll(params: EnqueueAllRequest): Promise<AgentRedeployJob[]> {
    const { kind, onlyOutdated } = params

    // Build agent list, filtering in DB where possible
    const agentRows = await (kind !== undefined
      ? sql<DbAgentRow[]>`
          SELECT id, node_id, kind, bundle_hash FROM agents WHERE kind = ${kind as string}
        `
      : sql<DbAgentRow[]>`
          SELECT id, node_id, kind, bundle_hash FROM agents
        `)

    let targets: DbAgentRow[] = agentRows
    if (onlyOutdated) {
      const { deployAgentHash, logAgentHash } = getBundleVersions()
      targets = agentRows.filter(a => {
        const expected = a.kind === 'log' ? logAgentHash : deployAgentHash
        return a.bundle_hash !== expected
      })
    }

    if (targets.length === 0) return []

    const agentIds = targets.map(a => a.id)

    // Single INSERT — partial unique index (agent_id WHERE state IN queued/running)
    // causes conflict rows to be silently skipped via ON CONFLICT DO NOTHING
    const rows = await sql<DbRedeployJob[]>`
      INSERT INTO agent_redeploy_jobs (agent_id)
      SELECT unnest(${agentIds}::uuid[])
      ON CONFLICT DO NOTHING
      RETURNING *
    `

    if (rows.length === 0) return []

    await getAgentRedeployQueue().addBulk(
      rows.map(r => ({
        name: 'redeploy',
        data: { jobId: r.id },
        opts: { attempts: 60, backoff: { type: 'fixed' as const, delay: 5000 } },
      })),
    )

    const jobs = rows.map(toJob)
    for (const job of jobs) sessionManager.broadcastRedeployUpdate(job)
    return jobs
  }

  async listJobs(filter: { agentId?: string; limit?: number }): Promise<AgentRedeployJob[]> {
    const limit = filter.limit ?? 50
    const rows = filter.agentId !== undefined
      ? await sql<DbRedeployJob[]>`
          SELECT * FROM agent_redeploy_jobs
          WHERE agent_id = ${filter.agentId}
          ORDER BY queued_at DESC
          LIMIT ${limit}
        `
      : await sql<DbRedeployJob[]>`
          SELECT * FROM agent_redeploy_jobs
          ORDER BY queued_at DESC
          LIMIT ${limit}
        `
    return rows.map(toJob)
  }

  async getJob(id: string): Promise<AgentRedeployJob> {
    const rows = await sql<DbRedeployJob[]>`
      SELECT * FROM agent_redeploy_jobs WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Redeploy job')
    return toJob(row)
  }

  async cancel(id: string): Promise<AgentRedeployJob> {
    const rows = await sql<DbRedeployJob[]>`
      SELECT * FROM agent_redeploy_jobs WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Redeploy job')
    if (row.state !== 'queued') {
      throw AppError.conflict('Only queued jobs can be cancelled')
    }

    // Remove from BullMQ queue first (best-effort; job may have just been picked up)
    const queue = getAgentRedeployQueue()
    const bullJobs = await queue.getJobs(['waiting', 'delayed'])
    const bullJob = bullJobs.find(j => (j.data as { jobId: string }).jobId === id)
    if (bullJob) await bullJob.remove()

    const updated = await sql<DbRedeployJob[]>`
      UPDATE agent_redeploy_jobs
      SET state = 'cancelled', finished_at = now()
      WHERE id = ${id} AND state = 'queued'
      RETURNING *
    `
    const updatedRow = updated[0]
    if (!updatedRow) throw AppError.conflict('Only queued jobs can be cancelled')

    const job = toJob(updatedRow)
    sessionManager.broadcastRedeployUpdate(job)
    return job
  }
}

export const agentRedeployService = new AgentRedeployService()

// ── Helpers ───────────────────────────────────────────────────────────────

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  )
}

// Re-export AgentKind type for use in routes
export type { AgentKind }
