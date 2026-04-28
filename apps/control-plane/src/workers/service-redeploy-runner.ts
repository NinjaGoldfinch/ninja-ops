import { Queue, Worker } from 'bullmq'
import { readFileSync } from 'node:fs'
import { Client as SshClient } from 'ssh2'
import { bullmqConnection } from '../db/redis.js'
import { sql } from '../db/client.js'
import { childLogger } from '../lib/logger.js'
import { config } from '../config.js'
import { sessionManager } from '../ws/session.js'
import { AppError } from '../errors.js'
import { JobLogger } from '../services/job-logger.js'
import type { ServiceRedeployJob, ServiceRedeployState, ServiceName } from '@ninja/types'

const log = childLogger('service-redeploy-runner')

export const SERVICE_REDEPLOY_QUEUE_NAME = 'service-redeploy'

let serviceRedeployQueue: Queue | null = null
let serviceRedeployWorker: Worker | null = null

export function getServiceRedeployQueue(): Queue {
  if (!serviceRedeployQueue) {
    throw new Error('Service redeploy queue not initialized — call startServiceRedeployWorker() first')
  }
  return serviceRedeployQueue
}

// ── DB helpers ────────────────────────────────────────────────────────────

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

async function transition(
  id: string,
  state: ServiceRedeployState,
  extra: { errorMessage?: string } = {},
): Promise<ServiceRedeployJob> {
  const now = new Date()
  const startedAt: Date | null = state === 'running' ? now : null
  const finishedAt: Date | null =
    state === 'success' || state === 'failed' || state === 'cancelled' ? now : null

  const rows = await sql<DbRedeployJob[]>`
    UPDATE service_redeploy_jobs
    SET
      state         = ${state},
      error_message = COALESCE(${extra.errorMessage ?? null}, error_message),
      started_at    = COALESCE(${startedAt}, started_at),
      finished_at   = COALESCE(${finishedAt}, finished_at)
    WHERE id = ${id}
    RETURNING *
  `
  const row = rows[0]
  if (!row) throw AppError.notFound('Service redeploy job')
  const job = toJob(row)
  sessionManager.broadcastServiceRedeployUpdate(job)
  return job
}

// ── SSH exec ──────────────────────────────────────────────────────────────

async function sshExecCommands(
  host: string,
  commands: string[],
  logger: JobLogger,
  timeoutMs = 300_000,
): Promise<void> {
  if (!config.SELF_DEPLOY_SSH_KEY) {
    throw AppError.internal('SELF_DEPLOY_SSH_KEY is not configured')
  }

  const privateKey = readFileSync(config.SELF_DEPLOY_SSH_KEY)
  const cmdStr = commands.map(c => c.trim()).join(' && ')

  await new Promise<void>((resolve, reject) => {
    const conn = new SshClient()
    const timer = setTimeout(() => {
      conn.end()
      reject(AppError.internal(`SSH exec timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    conn.on('ready', () => {
      conn.exec(cmdStr, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          conn.end()
          return reject(AppError.internal(`SSH exec error: ${err.message}`))
        }
        stream.on('data', (d: Buffer) => { logger.write('stdout', d.toString()) })
        stream.stderr.on('data', (d: Buffer) => { logger.write('stderr', d.toString()) })
        stream.on('close', (code: number) => {
          clearTimeout(timer)
          conn.end()
          if (code !== 0) {
            reject(AppError.internal(`Remote command exited with code ${code}`))
          } else {
            resolve()
          }
        })
      })
    })

    conn.on('error', (err) => {
      clearTimeout(timer)
      reject(AppError.internal(`SSH connection failed: ${err.message}`))
    })

    conn.connect({
      host,
      port: 22,
      username: 'root',
      privateKey,
    })
  })
}

// ── Job processor ─────────────────────────────────────────────────────────

const SERVICE_UNITS: Record<ServiceName, string> = {
  'control-plane': config.SERVICE_CONTROL_PLANE_UNIT,
  'dashboard': config.SERVICE_DASHBOARD_UNIT,
}

const SERVICE_DIRS: Record<ServiceName, string> = {
  'control-plane': config.SERVICE_CONTROL_PLANE_DIR,
  'dashboard': config.SERVICE_DASHBOARD_DIR,
}

async function runServiceRedeployJob(jobId: string): Promise<void> {
  const rows = await sql<DbRedeployJob[]>`SELECT * FROM service_redeploy_jobs WHERE id = ${jobId}`
  const row = rows[0]
  if (!row) throw new Error(`Service redeploy job ${jobId} not found`)
  if (row.state === 'cancelled') return

  const service = row.service as ServiceName
  const unit = SERVICE_UNITS[service]
  const workDir = SERVICE_DIRS[service]
  const targetVersion = row.target_version ?? 'HEAD'
  const logger = new JobLogger('service_redeploy', jobId)

  await transition(jobId, 'running')

  try {
    if (!config.SELF_DEPLOY_HOST) {
      throw AppError.internal('SELF_DEPLOY_HOST is not configured')
    }
    // For control-plane: mark success before restart because the process dies mid-job.
    // The new process picks up the already-completed job state on startup.
    // Error detection during the restart itself is sacrificed for simplicity.
    if (service === 'control-plane') {
      await sshExecCommands(config.SELF_DEPLOY_HOST, [
        `cd ${workDir}`,
        `git fetch origin`,
        `git reset --hard ${targetVersion}`,
        `pnpm install --frozen-lockfile`,
        `pnpm build --filter=control-plane`,
      ], logger)
      await logger.flush()
      await transition(jobId, 'success')
      // Restart after marking success — we won't be alive to record the outcome
      await sshExecCommands(config.SELF_DEPLOY_HOST, [
        `systemctl restart ${unit}`,
      ], logger)
    } else {
      await sshExecCommands(config.SELF_DEPLOY_HOST, [
        `cd ${workDir}`,
        `git fetch origin`,
        `git reset --hard ${targetVersion}`,
        `pnpm install --frozen-lockfile`,
        `pnpm build --filter=${service}`,
        `systemctl restart ${unit}`,
      ], logger)
      await logger.flush()
      await transition(jobId, 'success')
    }
  } catch (err) {
    await logger.flush().catch(() => undefined)
    const errorMessage = err instanceof Error ? err.message : String(err)
    await transition(jobId, 'failed', { errorMessage }).catch(() => undefined)
    throw err
  }
}

// ── Worker ────────────────────────────────────────────────────────────────

export async function startServiceRedeployWorker(): Promise<void> {
  const connection = bullmqConnection

  serviceRedeployQueue = new Queue(SERVICE_REDEPLOY_QUEUE_NAME, { connection })

  serviceRedeployWorker = new Worker(
    SERVICE_REDEPLOY_QUEUE_NAME,
    async (job) => {
      const { jobId } = job.data as { jobId: string }
      await runServiceRedeployJob(jobId)
    },
    {
      connection,
      concurrency: 1,
    },
  )

  serviceRedeployWorker.on('failed', (job, err) => {
    log.error({ bullmqJobId: job?.id ?? 'unknown', err }, 'Service redeploy job failed')
  })
}

export async function stopServiceRedeployWorker(): Promise<void> {
  await serviceRedeployWorker?.close()
  await serviceRedeployQueue?.close()
}
