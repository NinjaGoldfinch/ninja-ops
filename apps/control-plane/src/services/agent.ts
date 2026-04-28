import { sql } from '../db/client.js'
import { childLogger } from '../lib/logger.js'
import { signToken } from '../plugins/auth.js'
import { AppError } from '../errors.js'
import { config } from '../config.js'
import { sessionManager } from '../ws/session.js'

const log = childLogger('agent')
import type { Agent, AgentRegisterRequest, AgentRegisterResponse, AgentHeartbeat, AgentCommand, LogAgentRegisterRequest, LogAgentRegisterResponse } from '@ninja/types'
import type { WebSocket } from '@fastify/websocket'

interface DbAgent {
  id: string
  node_id: string
  vmid: number
  hostname: string
  version: string
  kind: string
  status: string
  last_seen_at: Date
  registered_at: Date
}

function toAgent(row: DbAgent): Agent {
  return {
    id: row.id,
    nodeId: row.node_id,
    vmid: row.vmid,
    hostname: row.hostname,
    version: row.version,
    kind: (row.kind ?? 'deploy') as Agent['kind'],
    status: row.status as Agent['status'],
    lastSeenAt: row.last_seen_at.toISOString(),
    registeredAt: row.registered_at.toISOString(),
  }
}

// In-memory registry of connected agent WebSocket connections
const connectedAgents = new Map<string, WebSocket>()

export class AgentService {
  async register(req: AgentRegisterRequest): Promise<AgentRegisterResponse>
  async register(req: LogAgentRegisterRequest & { kind: 'log' }): Promise<LogAgentRegisterResponse>
  async register(req: (AgentRegisterRequest | LogAgentRegisterRequest) & { kind?: 'deploy' | 'log' }): Promise<AgentRegisterResponse | LogAgentRegisterResponse> {
    // Validate shared secret
    if (req.secret !== config.AGENT_SECRET) {
      throw AppError.unauthorized('Invalid agent secret')
    }

    const kind = req.kind ?? 'deploy'
    const hostname = ('hostname' in req && req.hostname) ? req.hostname : `vmid-${req.vmid}`
    const version = req.version

    // Upsert agent record (unique on node_id, vmid, kind)
    const rows = await sql<DbAgent[]>`
      INSERT INTO agents (node_id, vmid, hostname, version, status, kind)
      VALUES (${req.nodeId}, ${req.vmid}, ${hostname}, ${version}, 'offline', ${kind})
      ON CONFLICT (node_id, vmid, kind) DO UPDATE SET
        hostname      = EXCLUDED.hostname,
        version       = EXCLUDED.version,
        last_seen_at  = now()
      RETURNING id, node_id, vmid, hostname, version, kind, status, last_seen_at, registered_at
    `
    const row = rows[0]
    if (!row) throw AppError.internal('Failed to register agent')

    const token = await signToken({
      sub: row.id,
      username: `agent:${row.id}`,
      role: 'viewer',
    }, config.AGENT_JWT_EXPIRY)

    return { agentId: row.id, token }
  }

  markConnected(agentId: string, ws: WebSocket): void {
    connectedAgents.set(agentId, ws)
    sql<DbAgent[]>`
      UPDATE agents SET status = 'idle', last_seen_at = now()
      WHERE id = ${agentId}
      RETURNING id, node_id, vmid, hostname, version, kind, status, last_seen_at, registered_at
    `.then(rows => {
      if (rows[0]) sessionManager.broadcastAgentStatus(toAgent(rows[0]))
    }).catch(
      (err: Error) => log.error({ agentId, err }, 'Failed to mark agent connected'),
    )
  }

  markDisconnected(agentId: string): void {
    connectedAgents.delete(agentId)
    sql<DbAgent[]>`
      UPDATE agents SET status = 'offline', last_seen_at = now()
      WHERE id = ${agentId}
      RETURNING id, node_id, vmid, hostname, version, kind, status, last_seen_at, registered_at
    `.then(rows => {
      if (rows[0]) sessionManager.broadcastAgentStatus(toAgent(rows[0]))
    }).catch(
      (err: Error) => log.error({ agentId, err }, 'Failed to mark agent disconnected'),
    )
  }

  isConnected(agentId: string): boolean {
    return connectedAgents.has(agentId)
  }

  getSocket(agentId: string): WebSocket | undefined {
    return connectedAgents.get(agentId)
  }

  sendCommand(agentId: string, command: AgentCommand): void {
    const ws = connectedAgents.get(agentId)
    if (!ws) throw AppError.agentOffline(-1)
    ws.send(JSON.stringify({ type: 'command', payload: command }))
  }

  async handleHeartbeat(heartbeat: AgentHeartbeat): Promise<void> {
    const rows = await sql<DbAgent[]>`
      UPDATE agents
      SET status = ${heartbeat.status}, last_seen_at = now()
      WHERE id = ${heartbeat.agentId}
      RETURNING id, node_id, vmid, hostname, version, kind, status, last_seen_at, registered_at
    `
    if (rows[0]) sessionManager.broadcastAgentStatus(toAgent(rows[0]))
  }

  async getById(id: string): Promise<Agent | null> {
    const rows = await sql<DbAgent[]>`
      SELECT id, node_id, vmid, hostname, version, kind, status, last_seen_at, registered_at
      FROM agents
      WHERE id = ${id}
    `
    const row = rows[0]
    return row ? toAgent(row) : null
  }

  async getAgentForVmid(nodeId: string, vmid: number): Promise<Agent | null> {
    const rows = await sql<DbAgent[]>`
      SELECT id, node_id, vmid, hostname, version, kind, status, last_seen_at, registered_at
      FROM agents
      WHERE node_id = ${nodeId} AND vmid = ${vmid}
    `
    const row = rows[0]
    return row ? toAgent(row) : null
  }

  async listAgents(): Promise<Agent[]> {
    const rows = await sql<DbAgent[]>`
      SELECT id, node_id, vmid, hostname, version, kind, status, last_seen_at, registered_at
      FROM agents
      ORDER BY registered_at ASC
    `
    return rows.map(toAgent)
  }

  async deleteAgent(id: string): Promise<void> {
    const result = await sql`DELETE FROM agents WHERE id = ${id}`
    if (result.count === 0) throw AppError.notFound('Agent')
    connectedAgents.delete(id)
  }
}

export const agentService = new AgentService()
