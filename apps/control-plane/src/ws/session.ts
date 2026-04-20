import type { WebSocket } from '@fastify/websocket'
import type { Role, GuestMetrics, NodeMetrics, DeployJob, DeployLogLine, ProvisioningJob, Agent, LogEntryRow, LogQueryParams } from '@ninja/types'

// Looser type that accepts both "key absent" and "key present as undefined"
// (needed because Zod's .partial() produces `T | undefined` for each field)
type LogFilter = { [K in keyof LogQueryParams]?: LogQueryParams[K] | undefined }

interface WsSession {
  ws: WebSocket
  userId: string
  role: Role
  metricSubscriptions: Set<string>   // "nodeId:vmid"
  deploySubscriptions: Set<string>   // jobId
  terminalSessions: Set<string>      // sessionId
  controlLogSubscribed: boolean
  logSubscriptions: Set<number>      // vmid
  logFilter: LogFilter | null
}

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

export function matchesLogFilter(entry: LogEntryRow, filter: LogFilter): boolean {
  if (filter.vmid !== undefined && entry.vmid !== filter.vmid) return false
  if (filter.vmids?.length && !filter.vmids.includes(entry.vmid)) return false
  if (filter.nodeId !== undefined && entry.nodeId !== filter.nodeId) return false
  if (filter.source !== undefined && entry.source !== filter.source) return false
  if (filter.sources?.length && !filter.sources.includes(entry.source)) return false
  if (filter.level !== undefined && entry.level !== filter.level) return false
  if (filter.levels?.length && !filter.levels.includes(entry.level)) return false
  if (filter.unit !== undefined && entry.unit !== filter.unit) return false
  if (filter.units?.length && entry.unit !== null && !filter.units.includes(entry.unit)) return false
  if (filter.from !== undefined && entry.ts < filter.from) return false
  if (filter.to !== undefined && entry.ts > filter.to) return false
  if (filter.search) {
    if (!entry.line.toLowerCase().includes(filter.search.toLowerCase())) return false
  }
  return true
}

export class SessionManager {
  private readonly sessions = new Map<string, WsSession>()

  add(connectionId: string, ws: WebSocket): void {
    this.sessions.set(connectionId, {
      ws,
      userId: '',
      role: 'viewer',
      metricSubscriptions: new Set(),
      deploySubscriptions: new Set(),
      terminalSessions: new Set(),
      controlLogSubscribed: false,
      logSubscriptions: new Set(),
      logFilter: null,
    })
  }

  authenticate(connectionId: string, userId: string, role: Role): void {
    const session = this.sessions.get(connectionId)
    if (!session) return
    session.userId = userId
    session.role = role
  }

  remove(connectionId: string): void {
    this.sessions.delete(connectionId)
  }

  get(connectionId: string): WsSession | undefined {
    return this.sessions.get(connectionId)
  }

  subscribeMetrics(connectionId: string, nodeId: string, vmid: number): void {
    this.sessions.get(connectionId)?.metricSubscriptions.add(`${nodeId}:${vmid}`)
  }

  unsubscribeMetrics(connectionId: string, nodeId: string, vmid: number): void {
    this.sessions.get(connectionId)?.metricSubscriptions.delete(`${nodeId}:${vmid}`)
  }

  subscribeDeploy(connectionId: string, jobId: string): void {
    this.sessions.get(connectionId)?.deploySubscriptions.add(jobId)
  }

  unsubscribeDeploy(connectionId: string, jobId: string): void {
    this.sessions.get(connectionId)?.deploySubscriptions.delete(jobId)
  }

  broadcastGuestMetrics(nodeId: string, vmid: number, data: GuestMetrics): void {
    const key = `${nodeId}:${vmid}`
    for (const session of this.sessions.values()) {
      if (session.metricSubscriptions.has(key)) {
        send(session.ws, { type: 'metrics_guest', data })
      }
    }
  }

  broadcastNodeMetrics(nodeId: string, data: NodeMetrics): void {
    for (const session of this.sessions.values()) {
      // Send to all authenticated sessions — the overview page needs node metrics
      // without having any guest subscriptions active
      if (session.userId) {
        send(session.ws, { type: 'metrics_node', data })
      }
    }
  }

  broadcastDeployUpdate(jobId: string, data: DeployJob): void {
    for (const session of this.sessions.values()) {
      if (session.deploySubscriptions.has(jobId)) {
        send(session.ws, { type: 'deploy_update', data })
      }
    }
  }

  broadcastDeployLog(jobId: string, data: DeployLogLine): void {
    for (const session of this.sessions.values()) {
      if (session.deploySubscriptions.has(jobId)) {
        send(session.ws, { type: 'deploy_log', data })
      }
    }
  }

  subscribeControlLog(connectionId: string): void {
    const s = this.sessions.get(connectionId)
    if (s) s.controlLogSubscribed = true
  }

  unsubscribeControlLog(connectionId: string): void {
    const s = this.sessions.get(connectionId)
    if (s) s.controlLogSubscribed = false
  }

  broadcastControlLog(stream: 'stdout' | 'stderr', data: string, ts: number): void {
    for (const session of this.sessions.values()) {
      if (session.controlLogSubscribed) {
        send(session.ws, { type: 'control_log', stream, data, ts })
      }
    }
  }

  subscribeLog(connectionId: string, vmid: number): void {
    this.sessions.get(connectionId)?.logSubscriptions.add(vmid)
  }

  unsubscribeLog(connectionId: string, vmid: number): void {
    this.sessions.get(connectionId)?.logSubscriptions.delete(vmid)
  }

  setLogFilter(connectionId: string, filter: LogFilter): void {
    const session = this.sessions.get(connectionId)
    if (session) session.logFilter = filter
  }

  broadcastLogLine(data: LogEntryRow): void {
    for (const session of this.sessions.values()) {
      if (!session.userId) continue

      // Legacy vmid-based subscriptions
      if (session.logSubscriptions.has(data.vmid)) {
        send(session.ws, { type: 'log_line', data })
        continue
      }

      // Filter-based subscriptions
      if (session.logFilter !== null) {
        if (matchesLogFilter(data, session.logFilter)) {
          send(session.ws, { type: 'log_line', data })
        }
      }
    }
  }

  broadcastProvisioningUpdate(data: ProvisioningJob): void {
    for (const session of this.sessions.values()) {
      if (session.userId) {
        send(session.ws, { type: 'provisioning_update', data })
      }
    }
  }

  broadcastAgentStatus(data: Agent): void {
    for (const session of this.sessions.values()) {
      if (session.userId) {
        send(session.ws, { type: 'agent_status', data })
      }
    }
  }
}

export const sessionManager = new SessionManager()
