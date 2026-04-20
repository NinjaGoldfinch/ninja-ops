import WebSocket from 'ws'
import type { AgentClientMessage, AgentCommand, AgentServerMessage } from '@ninja/types'
import { AgentServerMessageSchema } from '@ninja/types'
import { config } from './config.js'
import { log as rootLog } from './logger.js'
import { startHeartbeat, stopHeartbeat } from './heartbeat.js'

const log = rootLog.child({ component: 'ws' })

// Mutable state shared with heartbeat and runner
export let currentJobId: string | null = null

export function setCurrentJobId(id: string | null): void {
  currentJobId = id
}

let ws: WebSocket | null = null
let onCommandCallback: ((cmd: AgentCommand) => void) | null = null
let reregisterFn: (() => Promise<{ agentId: string; token: string }>) | null = null
let agentIdRef = ''
let tokenRef = ''
let reconnectScheduled = false
let needsReregister = false

export function setOnCommand(cb: (cmd: AgentCommand) => void): void {
  onCommandCallback = cb
}

export function setReregister(fn: () => Promise<{ agentId: string; token: string }>): void {
  reregisterFn = fn
}

export function send(msg: AgentClientMessage): void {
  if (ws === null || ws.readyState !== WebSocket.OPEN) {
    log.warn('Cannot send message — WebSocket not open', { type: msg.type })
    return
  }
  ws.send(JSON.stringify(msg))
}

function wsUrl(): string {
  return config.CONTROL_PLANE_URL
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://') + '/ws/agent'
}

function scheduleReconnect(): void {
  if (reconnectScheduled) return
  reconnectScheduled = true
  setTimeout(() => {
    reconnectScheduled = false
    if (needsReregister && reregisterFn !== null) {
      needsReregister = false
      log.info('Re-registering with control plane to obtain fresh token')
      reregisterFn().then(({ agentId, token }) => {
        startConnection(agentId, token)
      }).catch((err: Error) => {
        log.warn('Re-registration failed, retrying', { error: err.message })
        needsReregister = true
        scheduleReconnect()
      })
      return
    }
    startConnection(agentIdRef, tokenRef)
  }, config.RECONNECT_DELAY_MS)
}

export function startConnection(agentId: string, token: string): void {
  agentIdRef = agentId
  tokenRef = token

  const url = wsUrl()
  log.debug('Connecting to WebSocket', { url })

  const socket = new WebSocket(url)
  ws = socket

  let authTimeout: NodeJS.Timeout | null = null

  socket.on('open', () => {
    log.info('WebSocket connected, sending auth')
    socket.send(JSON.stringify({ type: 'auth', agentId, token }))
    authTimeout = setTimeout(() => {
      log.warn('Auth timeout — closing and reconnecting')
      socket.close()
    }, 10_000)
  })

  socket.on('message', (raw: Buffer) => {
    let parsed: AgentServerMessage
    try {
      const result = AgentServerMessageSchema.safeParse(JSON.parse(raw.toString()))
      if (!result.success) {
        log.warn('Received unparseable server message', { issues: result.error.issues })
        return
      }
      parsed = result.data
    } catch {
      log.warn('Failed to parse WebSocket message')
      return
    }

    if (parsed.type === 'auth_ok') {
      if (authTimeout !== null) {
        clearTimeout(authTimeout)
        authTimeout = null
      }
      log.info('Authenticated with control plane')
      startHeartbeat(agentId)
      return
    }

    if (parsed.type === 'command') {
      if (onCommandCallback !== null) {
        onCommandCallback(parsed.payload)
      }
      return
    }

    if (parsed.type === 'error') {
      log.warn('Received error from server', { code: parsed.code, message: parsed.message })
      if (parsed.code === 'UNAUTHORIZED') {
        needsReregister = true
      }
    }
  })

  socket.on('close', () => {
    log.info('WebSocket closed, scheduling reconnect')
    stopHeartbeat()
    ws = null
    scheduleReconnect()
  })

  socket.on('error', (err: Error) => {
    log.warn('WebSocket error', { error: err.message })
    // 'close' event will follow and trigger reconnect
  })
}

export function closeConnection(): void {
  stopHeartbeat()
  reconnectScheduled = true // prevent auto-reconnect after manual close
  if (ws !== null) {
    ws.close()
    ws = null
  }
}
