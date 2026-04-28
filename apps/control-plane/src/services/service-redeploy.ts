import { sql } from '../db/client.js'
import { AppError } from '../errors.js'
import { sessionManager } from '../ws/session.js'
import { getServiceRedeployQueue } from '../workers/service-redeploy-runner.js'
import { getServiceVersions } from './service-versions.js'
import type { ServiceRedeployJob, ServiceRedeployState, ServiceName, EnqueueServiceRedeploy } from '@ninja/types'

// ── DB row ────────────────────────────────────────────────────────────────

interface DbRedeployJob {
  id: string
  service: string
  state: string
  target_version: string | null
  error_message: string | null
  queued_at: Date
  started_at: Date | null
  finished_at: Date | null
}

function toJob(row: DbRedeployJob): ServiceRedeployJob {
  return {
    id: row.id,
    service: row.service as ServiceName,
    state: row.state as ServiceRedeployState,
    targetVersion: row.target_version ?? undefined,
    errorMessage: row.error_message,
    queuedAt: row.queued_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  }
}

// ── Service ───────────────────────────────────────────────────────────────

export class ServiceRedeployService {
  async enqueue(input: EnqueueServiceRedeploy): Promise<ServiceRedeployJob> {
    let targetVersion = input.targetVersion
    if (!targetVersion) {
      const versions = await getServiceVersions()
      targetVersion = versions[input.service].latest
    }

    let row: DbRedeployJob
    try {
      const rows = await sql<DbRedeployJob[]>`
        INSERT INTO service_redeploy_jobs (service, target_version)
        VALUES (${input.service}, ${targetVersion ?? null})
        RETURNING *
      `
      row = rows[0]!
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict(`A redeploy is already queued or running for ${input.service}`)
      }
      throw err
    }

    await getServiceRedeployQueue().add('redeploy', { jobId: row.id }, {
      attempts: 3,
      backoff: { type: 'fixed', delay: 10_000 },
    })

    const job = toJob(row)
    sessionManager.broadcastServiceRedeployUpdate(job)
    return job
  }

  async listJobs(filter: { service?: ServiceName; limit?: number }): Promise<ServiceRedeployJob[]> {
    const limit = filter.limit ?? 50
    const rows = filter.service !== undefined
      ? await sql<DbRedeployJob[]>`
          SELECT * FROM service_redeploy_jobs
          WHERE service = ${filter.service}
          ORDER BY queued_at DESC
          LIMIT ${limit}
        `
      : await sql<DbRedeployJob[]>`
          SELECT * FROM service_redeploy_jobs
          ORDER BY queued_at DESC
          LIMIT ${limit}
        `
    return rows.map(toJob)
  }

  async getJob(id: string): Promise<ServiceRedeployJob> {
    const rows = await sql<DbRedeployJob[]>`
      SELECT * FROM service_redeploy_jobs WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Service redeploy job')
    return toJob(row)
  }

  async cancel(id: string): Promise<ServiceRedeployJob> {
    const rows = await sql<DbRedeployJob[]>`
      SELECT * FROM service_redeploy_jobs WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Service redeploy job')
    if (row.state !== 'queued') throw AppError.conflict('Only queued jobs can be cancelled')

    const queue = getServiceRedeployQueue()
    const bullJobs = await queue.getJobs(['waiting', 'delayed'])
    const bullJob = bullJobs.find(j => (j.data as { jobId: string }).jobId === id)
    if (bullJob) await bullJob.remove()

    const updated = await sql<DbRedeployJob[]>`
      UPDATE service_redeploy_jobs
      SET state = 'cancelled', finished_at = now()
      WHERE id = ${id} AND state = 'queued'
      RETURNING *
    `
    const updatedRow = updated[0]
    if (!updatedRow) throw AppError.conflict('Only queued jobs can be cancelled')

    const job = toJob(updatedRow)
    sessionManager.broadcastServiceRedeployUpdate(job)
    return job
  }
}

export const serviceRedeployService = new ServiceRedeployService()

// ── Helpers ───────────────────────────────────────────────────────────────

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  )
}
