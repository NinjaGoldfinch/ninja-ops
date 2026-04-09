import type { WebSocket } from '@fastify/websocket'
import type { Role, GuestMetrics, NodeMetrics, DeployJob, DeployLogLine } from '@ninja/types'

interface WsSession {
  ws: WebSocket
  userId: string
  role: Role
  metricSubscriptions: Set<string>   // "nodeId:vmid"
  deploySubscriptions: Set<string>   // jobId
  terminalSessions: Set<string>      // sessionId
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
    const key = `${nodeId}:*`
    for (const session of this.sessions.values()) {
      // Broadcast to any session subscribed to any guest on this node
      const hasNodeSub = [...session.metricSubscriptions].some(k => k.startsWith(`${nodeId}:`))
      if (hasNodeSub || session.metricSubscriptions.has(key)) {
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
}

export const sessionManager = new SessionManager()
