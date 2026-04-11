import type { WebSocket } from '@fastify/websocket'
import type { Role, GuestMetrics, NodeMetrics, DeployJob, DeployLogLine, ProvisioningJob, Agent } from '@ninja/types'

interface WsSession {
  ws: WebSocket
  userId: string
  role: Role
  metricSubscriptions: Set<string>   // "nodeId:vmid"
  deploySubscriptions: Set<string>   // jobId
  terminalSessions: Set<string>      // sessionId
  controlLogSubscribed: boolean
}

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg))
  }
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
