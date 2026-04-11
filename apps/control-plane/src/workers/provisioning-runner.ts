import { Queue, Worker } from 'bullmq'
import { bullmqConnection } from '../db/redis.js'
import { sql } from '../db/client.js'
import { proxmoxService } from '../services/proxmox.js'
import { nodeService } from '../services/node.js'
import { deployAgentIntoLxc, deployLogAgentIntoLxc } from '../services/agent-deployer.js'
import { JobLogger } from '../services/job-logger.js'
import { sessionManager } from '../ws/session.js'
import { AppError } from '../errors.js'
import type { LxcCreateRequest, QemuCreateRequest, ProvisioningJob, ProvisioningState } from '@ninja/types'

export const PROVISIONING_QUEUE_NAME = 'provisioning'

let provisioningQueue: Queue | null = null
let provisioningWorker: Worker | null = null

export function getProvisioningQueue(): Queue {
  if (!provisioningQueue) {
    throw new Error('Provisioning queue not initialized — call startProvisioningWorker() first')
  }
  return provisioningQueue
}

// ── DB helpers ────────────────────────────────────────────────────────────

interface DbJob {
  id: string
  node_id: string
  guest_type: 'lxc' | 'qemu'
  vmid: number
  name: string
  proxmox_upid: string | null
  state: string
  deploy_agent: boolean
  deploy_log_agent: boolean
  config: LxcCreateRequest | QemuCreateRequest
  error_message: string | null
  created_at: Date
  updated_at: Date
}

function toJob(row: DbJob): ProvisioningJob {
  return {
    id: row.id,
    nodeId: row.node_id,
    guestType: row.guest_type,
    vmid: row.vmid,
    name: row.name,
    proxmoxUpid: row.proxmox_upid,
    state: row.state as ProvisioningState,
    deployAgent: row.deploy_agent,
    deployLogAgent: row.deploy_log_agent,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

async function transition(
  id: string,
  state: ProvisioningState,
  extra: { proxmoxUpid?: string; errorMessage?: string } = {},
): Promise<ProvisioningJob> {
  const rows = await sql<DbJob[]>`
    UPDATE provisioning_jobs
    SET
      state = ${state},
      updated_at = now(),
      proxmox_upid = COALESCE(${extra.proxmoxUpid ?? null}, proxmox_upid),
      error_message = COALESCE(${extra.errorMessage ?? null}, error_message)
    WHERE id = ${id}
    RETURNING *
  `
  const row = rows[0]
  if (!row) throw AppError.notFound('Provisioning job')
  const job = toJob(row)
  sessionManager.broadcastProvisioningUpdate(job)
  return job
}

// ── State machine ─────────────────────────────────────────────────────────

async function runProvisioningJob(jobId: string): Promise<void> {
  const rows = await sql<DbJob[]>`SELECT * FROM provisioning_jobs WHERE id = ${jobId}`
  const row = rows[0]
  if (!row) throw new Error(`Provisioning job ${jobId} not found`)

  const { node, tokenSecret, sshPassword, sshHost, sshAuthMethod, sshPrivateKey, sshKeyPassphrase } = await nodeService.getWithSecret(row.node_id)
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

  // postgres.js auto-parses JSONB columns, but guard against it returning a raw string
  const params = (typeof row.config === 'string'
    ? JSON.parse(row.config)
    : row.config) as LxcCreateRequest | QemuCreateRequest

  // pending → creating
  const upid = row.guest_type === 'lxc'
    ? await proxmoxService.createLxc(cfg, params as LxcCreateRequest, row.vmid)
    : await proxmoxService.createQemu(cfg, params as QemuCreateRequest, row.vmid)

  await transition(jobId, 'creating', { proxmoxUpid: upid })

  // creating → starting
  await proxmoxService.waitForTask(cfg, upid)
  await transition(jobId, 'starting')

  const startAfterCreate = (params as LxcCreateRequest).startAfterCreate
  if (startAfterCreate) {
    // Proxmox starts the guest automatically when start=1 is passed to create.
    // Don't call powerAction here — the guest may already be running and the
    // API returns 500 "CT already running" in that case.

    // Poll until running (60s timeout)
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const status = await proxmoxService.getGuestStatus(cfg, row.guest_type, row.vmid)
        .catch(() => 'unknown')
      if (status === 'running') break
      await new Promise(resolve => setTimeout(resolve, 2_000))
    }

    const finalStatus = await proxmoxService.getGuestStatus(cfg, row.guest_type, row.vmid)
      .catch(() => 'unknown')
    if (finalStatus !== 'running') {
      throw new Error('Guest did not reach running state within 60s')
    }
  }

  // LXC + deployAgent → deploying (deploy-agent first, then log-agent) → done
  if (row.guest_type === 'lxc' && (row.deploy_agent || row.deploy_log_agent)) {
    await transition(jobId, 'deploying')

    if (row.deploy_agent) {
      const logger = new JobLogger('provisioning', jobId)
      await deployAgentIntoLxc(cfg, row.vmid, row.node_id, logger)
      await logger.flush()
    }

    if (row.deploy_log_agent) {
      const logger = new JobLogger('log_agent_deploy', `${row.node_id}/${row.vmid}`)
      await deployLogAgentIntoLxc(cfg, row.vmid, row.node_id, '', logger)
      await logger.flush()
    }
  }

  await transition(jobId, 'done')
}

// ── Worker ────────────────────────────────────────────────────────────────

export async function startProvisioningWorker(): Promise<void> {
  const connection = bullmqConnection

  provisioningQueue = new Queue(PROVISIONING_QUEUE_NAME, { connection })

  provisioningWorker = new Worker(
    PROVISIONING_QUEUE_NAME,
    async (job) => {
      const { jobId } = job.data as { jobId: string }
      try {
        await runProvisioningJob(jobId)
      } catch (err) {
        const errorMessage = err instanceof AppError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
        await transition(jobId, 'failed', { errorMessage }).catch(() => undefined)
      }
    },
    { connection },
  )

  provisioningWorker.on('failed', (job, err) => {
    console.error(`[provisioning-runner] Job ${job?.id ?? 'unknown'} failed:`, err.message)
  })
}

export async function stopProvisioningWorker(): Promise<void> {
  await provisioningWorker?.close()
  await provisioningQueue?.close()
}
