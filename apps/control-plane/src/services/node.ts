import { sql } from '../db/client.js'
import { cryptoService } from './crypto.js'
import { proxmoxService } from './proxmox.js'
import { AppError } from '../errors.js'
import type { ProxmoxNode } from '@ninja/types'

interface DbNode {
  id: string
  name: string
  host: string
  port: number
  token_id: string
  token_secret: string
  ssh_user: string
  ssh_password: string | null
  ssh_host: string | null
  status: string
  created_at: Date
  updated_at: Date
}

function toNode(row: DbNode): ProxmoxNode {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    tokenId: row.token_id,
    sshUser: row.ssh_user,
    sshHost: row.ssh_host ?? undefined,
    status: row.status as ProxmoxNode['status'],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

interface CreateNodeParams {
  name: string
  host: string
  port: number
  tokenId: string
  tokenSecret: string
  sshUser?: string
  sshPassword?: string
  sshHost?: string
}

interface UpdateNodeParams {
  name?: string | undefined
  host?: string | undefined
  port?: number | undefined
  tokenId?: string | undefined
  tokenSecret?: string | undefined
  sshUser?: string | undefined
  sshPassword?: string | undefined
  sshHost?: string | undefined
}

export class NodeService {
  async list(): Promise<ProxmoxNode[]> {
    const rows = await sql<DbNode[]>`
      SELECT id, name, host, port, token_id, token_secret, ssh_user, ssh_password, ssh_host, status, created_at, updated_at
      FROM nodes
      ORDER BY created_at ASC
    `
    return rows.map(toNode)
  }

  async get(id: string): Promise<ProxmoxNode> {
    const rows = await sql<DbNode[]>`
      SELECT id, name, host, port, token_id, token_secret, ssh_user, ssh_password, ssh_host, status, created_at, updated_at
      FROM nodes
      WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Node')
    return toNode(row)
  }

  async getWithSecret(id: string): Promise<{ node: ProxmoxNode; tokenSecret: string; sshPassword: string | null; sshHost: string | null }> {
    const rows = await sql<DbNode[]>`
      SELECT id, name, host, port, token_id, token_secret, ssh_user, ssh_password, ssh_host, status, created_at, updated_at
      FROM nodes
      WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Node')
    return {
      node: toNode(row),
      tokenSecret: cryptoService.decrypt(row.token_secret),
      sshPassword: row.ssh_password ? cryptoService.decrypt(row.ssh_password) : null,
      sshHost: row.ssh_host ?? null,
    }
  }

  async create(params: CreateNodeParams): Promise<ProxmoxNode> {
    // Test connectivity before persisting
    await proxmoxService
      .testConnection({
        host: params.host,
        port: params.port,
        tokenId: params.tokenId,
        tokenSecret: params.tokenSecret,
      })
      .catch(() => {
        throw AppError.proxmoxError('Could not connect to Proxmox with the provided credentials')
      })

    const encryptedSecret = cryptoService.encrypt(params.tokenSecret)
    const encryptedSshPassword = params.sshPassword ? cryptoService.encrypt(params.sshPassword) : null

    const rows = await sql<DbNode[]>`
      INSERT INTO nodes (name, host, port, token_id, token_secret, ssh_user, ssh_password, ssh_host, status)
      VALUES (
        ${params.name}, ${params.host}, ${params.port}, ${params.tokenId}, ${encryptedSecret},
        ${params.sshUser ?? 'root'}, ${encryptedSshPassword}, ${params.sshHost ?? null}, 'online'
      )
      RETURNING id, name, host, port, token_id, token_secret, ssh_user, ssh_password, ssh_host, status, created_at, updated_at
    `
    const row = rows[0]
    if (!row) throw AppError.internal('Failed to create node')
    return toNode(row)
  }

  async update(id: string, params: UpdateNodeParams): Promise<ProxmoxNode> {
    const existing = await sql<DbNode[]>`
      SELECT id, name, host, port, token_id, token_secret, ssh_user, ssh_password, ssh_host, status, created_at, updated_at
      FROM nodes WHERE id = ${id}
    `
    const row = existing[0]
    if (!row) throw AppError.notFound('Node')

    const encryptedSecret = params.tokenSecret !== undefined
      ? cryptoService.encrypt(params.tokenSecret)
      : row.token_secret

    const encryptedSshPassword = params.sshPassword !== undefined
      ? cryptoService.encrypt(params.sshPassword)
      : row.ssh_password

    const updated = await sql<DbNode[]>`
      UPDATE nodes SET
        name         = ${params.name ?? row.name},
        host         = ${params.host ?? row.host},
        port         = ${params.port ?? row.port},
        token_id     = ${params.tokenId ?? row.token_id},
        token_secret = ${encryptedSecret},
        ssh_user     = ${params.sshUser ?? row.ssh_user},
        ssh_password = ${encryptedSshPassword},
        ssh_host     = ${params.sshHost !== undefined ? (params.sshHost || null) : row.ssh_host},
        updated_at   = now()
      WHERE id = ${id}
      RETURNING id, name, host, port, token_id, token_secret, ssh_user, ssh_password, ssh_host, status, created_at, updated_at
    `
    const updatedRow = updated[0]
    if (!updatedRow) throw AppError.internal('Failed to update node')
    return toNode(updatedRow)
  }

  async delete(id: string): Promise<void> {
    const result = await sql`DELETE FROM nodes WHERE id = ${id}`
    if (result.count === 0) throw AppError.notFound('Node')
  }

  async syncStatus(id: string): Promise<ProxmoxNode> {
    const { node, tokenSecret } = await this.getWithSecret(id)
    let newStatus: ProxmoxNode['status'] = 'offline'

    try {
      await proxmoxService.testConnection({
        host: node.host,
        port: node.port,
        tokenId: node.tokenId,
        tokenSecret,
      })
      newStatus = 'online'
    } catch {
      newStatus = 'offline'
    }

    const rows = await sql<DbNode[]>`
      UPDATE nodes SET status = ${newStatus}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, host, port, token_id, token_secret, ssh_user, ssh_password, ssh_host, status, created_at, updated_at
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Node')
    return toNode(row)
  }
}

export const nodeService = new NodeService()
