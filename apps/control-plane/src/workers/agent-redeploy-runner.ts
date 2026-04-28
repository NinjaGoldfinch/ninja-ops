import { Queue, Worker } from 'bullmq'
import { bullmqConnection } from '../db/redis.js'
import { sql } from '../db/client.js'
import { childLogger } from '../lib/logger.js'
import { nodeService } from '../services/node.js'
import { agentService } from '../services/agent.js'
import { deployAgentIntoLxc, deployLogAgentIntoLxc } from '../services/agent-deployer.js'
import { JobLogger } from '../services/job-logger.js'
import { sessionManager } from '../ws/session.js'
import { AppError } from '../errors.js'
import { acquireNodeLock, releaseNodeLock } from '../lib/node-lock.js'
import type { AgentRedeployJob, AgentRedeployState } from '@ninja/types'

const log = childLogger('agent-redeploy-runner')

export const AGENT_REDEPLOY_QUEUE_NAME = 'agent-redeploy'

let agentRedeployQueue: Queue | null = null
let agentRedeployWorker: Worker | null = null

export function getAgentRedeployQueue(): Queue {
  if (!agentRedeployQueue) {
    throw new Error('Agent redeploy queue not initialized — call startAgentRedeployWorker() first')
  }
  return agentRedeployQueue
}

// ── DB helpers ────────────────────────────────────────────────────────────

interface DbRedeployJob {
  id: string
  agent_id: string
  state: string
  error_message: string | null
  queued_at: Date
  started_at: Date | null
  finished_at: Date | null
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

async function transition(
  id: string,
  state: AgentRedeployState,
  extra: { errorMessage?: string } = {},
): Promise<AgentRedeployJob> {
  const now = new Date()
  const startedAt: Date | null = state === 'running' ? now : null
  const finishedAt: Date | null =
    state === 'success' || state === 'failed' || state === 'cancelled' ? now : null

  const rows = await sql<DbRedeployJob[]>`
    UPDATE agent_redeploy_jobs
    SET
      state         = ${state},
      error_message = COALESCE(${extra.errorMessage ?? null}, error_message),
      started_at    = COALESCE(${startedAt}, started_at),
      finished_at   = COALESCE(${finishedAt}, finished_at)
    WHERE id = ${id}
    RETURNING *
  `
  const row = rows[0]
  if (!row) throw AppError.notFound('Redeploy job')
  const job = toJob(row)
  sessionManager.broadcastRedeployUpdate(job)
  return job
}


// ── Job processor ─────────────────────────────────────────────────────────

async function runRedeployJob(jobId: string): Promise<void> {
  const rows = await sql<DbRedeployJob[]>`SELECT * FROM agent_redeploy_jobs WHERE id = ${jobId}`
  const row = rows[0]
  if (!row) throw new Error(`Redeploy job ${jobId} not found`)

  // Allow cancelled jobs to be skipped (may have been cancelled while queued)
  if (row.state === 'cancelled') return

  const agent = await agentService.getById(row.agent_id)
  if (!agent) throw new Error(`Agent ${row.agent_id} not found`)

  // Guard: only LXC agents are supported — check provisioning history
  const guestTypeRows = await sql<{ guest_type: string }[]>`
    SELECT guest_type FROM provisioning_jobs
    WHERE node_id = ${agent.nodeId} AND vmid = ${agent.vmid}
    ORDER BY created_at DESC
    LIMIT 1
  `
  if (guestTypeRows[0] && guestTypeRows[0].guest_type !== 'lxc') {
    throw AppError.internal(`Agent redeploy is only supported for LXC containers (vmid=${agent.vmid} is ${guestTypeRows[0].guest_type})`)
  }

  const { node, tokenSecret, sshPassword, sshHost, sshAuthMethod, sshPrivateKey, sshKeyPassphrase } =
    await nodeService.getWithSecret(agent.nodeId)

  const cfg = {
    host: node.host,
    port: node.port,
    tokenId: node.tokenId,
    tokenSecret,
    nodeName: node.name,
    sshUser: node.sshUser,
    sshHost,
    sshAuthMethod,
    sshPassword,
    sshPrivateKey,
    sshKeyPassphrase,
  }

  // Attempt to acquire per-node mutex — serializes agent deploys on the same Proxmox node.
  // Throws immediately on contention so BullMQ retries the job.
  const locked = await acquireNodeLock(agent.nodeId, jobId)
  if (!locked) {
    throw new Error(`Node ${agent.nodeId} is locked by another agent deploy — will retry`)
  }

  try {
    await transition(jobId, 'running')

    const logger = new JobLogger('agent_redeploy', jobId)

    if (agent.kind === 'log') {
      await deployLogAgentIntoLxc(cfg, agent.vmid, agent.nodeId, '', logger)
    } else {
      await deployAgentIntoLxc(cfg, agent.vmid, agent.nodeId, logger)
    }

    await logger.flush()
    await transition(jobId, 'success')
  } catch (err) {
    const errorMessage = err instanceof AppError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err)
    await transition(jobId, 'failed', { errorMessage }).catch(() => undefined)
    throw err
  } finally {
    await releaseNodeLock(agent.nodeId)
  }
}

// ── Worker ────────────────────────────────────────────────────────────────

export async function startAgentRedeployWorker(): Promise<void> {
  const connection = bullmqConnection

  agentRedeployQueue = new Queue(AGENT_REDEPLOY_QUEUE_NAME, { connection })

  agentRedeployWorker = new Worker(
    AGENT_REDEPLOY_QUEUE_NAME,
    async (job) => {
      const { jobId } = job.data as { jobId: string }
      await runRedeployJob(jobId)
    },
    {
      connection,
      concurrency: 5,
    },
  )

  agentRedeployWorker.on('failed', (job, err) => {
    log.error({ bullmqJobId: job?.id ?? 'unknown', err }, 'Agent redeploy job failed')
  })
}

export async function stopAgentRedeployWorker(): Promise<void> {
  await agentRedeployWorker?.close()
  await agentRedeployQueue?.close()
}
