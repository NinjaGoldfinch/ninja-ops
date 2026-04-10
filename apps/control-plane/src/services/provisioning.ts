import { sql } from '../db/client.js'
import { AppError } from '../errors.js'
import { proxmoxService } from './proxmox.js'
import { nodeService } from './node.js'
import { getProvisioningQueue } from '../workers/provisioning-runner.js'
import type {
  ProvisioningJob,
  ProvisioningState,
  LxcCreateRequest,
  QemuCreateRequest,
  ProxmoxTemplate,
  ProxmoxIso,
  ProxmoxStorage,
} from '@ninja/types'

// ── DB row type ───────────────────────────────────────────────────────────

interface DbProvisioningJob {
  id: string
  node_id: string
  guest_type: 'lxc' | 'qemu'
  vmid: number
  name: string
  proxmox_upid: string | null
  state: string
  deploy_agent: boolean
  config: unknown
  error_message: string | null
  created_at: Date
  updated_at: Date
}

function toJob(row: DbProvisioningJob): ProvisioningJob {
  return {
    id: row.id,
    nodeId: row.node_id,
    guestType: row.guest_type,
    vmid: row.vmid,
    name: row.name,
    proxmoxUpid: row.proxmox_upid,
    state: row.state as ProvisioningState,
    deployAgent: row.deploy_agent,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export class ProvisioningService {
  async create(params: LxcCreateRequest | QemuCreateRequest): Promise<ProvisioningJob> {
    const guestType = 'hostname' in params ? 'lxc' : 'qemu'
    const name = 'hostname' in params ? params.hostname : params.name
    const nodeId = params.nodeId

    // Resolve VMID — use provided or ask Proxmox for next available
    let vmid: number
    if (params.vmid !== undefined) {
      vmid = params.vmid
    } else {
      const { node, tokenSecret } = await nodeService.getWithSecret(nodeId)
      vmid = await proxmoxService.nextVmid({
        host: node.host,
        port: node.port,
        tokenId: node.tokenId,
        tokenSecret,
        nodeName: node.name,
      })
    }

    const rows = await sql<DbProvisioningJob[]>`
      INSERT INTO provisioning_jobs (node_id, guest_type, vmid, name, deploy_agent, config)
      VALUES (
        ${nodeId},
        ${guestType},
        ${vmid},
        ${name},
        ${'deployAgent' in params ? params.deployAgent : false},
        ${JSON.stringify(params)}::jsonb
      )
      RETURNING *
    `

    const job = rows[0]
    if (!job) throw AppError.internal('Failed to create provisioning job')

    await getProvisioningQueue().add('provision', { jobId: job.id })

    return toJob(job)
  }

  async getJob(id: string): Promise<ProvisioningJob> {
    const rows = await sql<DbProvisioningJob[]>`
      SELECT * FROM provisioning_jobs WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Provisioning job')
    return toJob(row)
  }

  async listJobs(nodeId?: string): Promise<ProvisioningJob[]> {
    const rows = nodeId !== undefined
      ? await sql<DbProvisioningJob[]>`
          SELECT * FROM provisioning_jobs WHERE node_id = ${nodeId} ORDER BY created_at DESC
        `
      : await sql<DbProvisioningJob[]>`
          SELECT * FROM provisioning_jobs ORDER BY created_at DESC
        `
    return rows.map(toJob)
  }

  async deleteJob(id: string): Promise<void> {
    const rows = await sql<DbProvisioningJob[]>`
      SELECT state FROM provisioning_jobs WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Provisioning job')

    const terminalStates: ProvisioningState[] = ['done', 'failed']
    if (!terminalStates.includes(row.state as ProvisioningState)) {
      throw AppError.conflict('Can only delete jobs in a terminal state (done or failed)')
    }

    await sql`DELETE FROM provisioning_jobs WHERE id = ${id}`
  }

  async updateState(
    id: string,
    state: ProvisioningState,
    extra: { proxmoxUpid?: string; errorMessage?: string } = {},
  ): Promise<ProvisioningJob> {
    const rows = await sql<DbProvisioningJob[]>`
      UPDATE provisioning_jobs
      SET
        state = ${state},
        updated_at = now(),
        ${extra.proxmoxUpid !== undefined ? sql`proxmox_upid = ${extra.proxmoxUpid},` : sql``}
        ${extra.errorMessage !== undefined ? sql`error_message = ${extra.errorMessage},` : sql``}
        id = id
      WHERE id = ${id}
      RETURNING *
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Provisioning job')
    return toJob(row)
  }

  async discoverTemplates(nodeId: string): Promise<ProxmoxTemplate[]> {
    const { node, tokenSecret } = await nodeService.getWithSecret(nodeId)
    const cfg = { host: node.host, port: node.port, tokenId: node.tokenId, tokenSecret, nodeName: node.name }

    const items = await proxmoxService.listContent(cfg, 'vztmpl')
    return items
      .filter(i => /\.tar\./i.test(i.volid))
      .map(i => ({
        volid: i.volid,
        name: i.volid.split('/').pop()?.replace(/\.tar\.\w+$/, '') ?? i.volid,
        size: i.size,
        storage: i.storage,
      }))
  }

  async discoverIsos(nodeId: string): Promise<ProxmoxIso[]> {
    const { node, tokenSecret } = await nodeService.getWithSecret(nodeId)
    const cfg = { host: node.host, port: node.port, tokenId: node.tokenId, tokenSecret, nodeName: node.name }

    const items = await proxmoxService.listContent(cfg, 'iso')
    return items.map(i => ({
      volid: i.volid,
      name: i.volid.split('/').pop() ?? i.volid,
      size: i.size,
      storage: i.storage,
    }))
  }

  async discoverStorages(nodeId: string): Promise<ProxmoxStorage[]> {
    const { node, tokenSecret } = await nodeService.getWithSecret(nodeId)
    const cfg = { host: node.host, port: node.port, tokenId: node.tokenId, tokenSecret, nodeName: node.name }

    return proxmoxService.listStorages(cfg)
  }
}

export const provisioningService = new ProvisioningService()
