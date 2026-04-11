import WebSocket from 'ws'
import type { LogAgentClientMessage } from '@ninja/types'
import { LogAgentServerMessageSchema } from '@ninja/types'
import { config } from './config.js'
import { log } from './logger.js'
import { startJournal } from './journal.js'
import { startHeartbeat, stopHeartbeat } from './heartbeat.js'

let ws: WebSocket | null = null
let agentIdRef = ''
let tokenRef = ''
let stopJournal: (() => void) | null = null
let reconnectScheduled = false

export function send(msg: LogAgentClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function wsUrl(): string {
  return config.CONTROL_PLANE_URL
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://') + '/ws/log-agent'
}

function scheduleReconnect(): void {
  if (reconnectScheduled) return
  reconnectScheduled = true
  setTimeout(() => {
    reconnectScheduled = false
    startConnection(agentIdRef, tokenRef)
  }, config.RECONNECT_DELAY_MS)
}

export function startConnection(agentId: string, token: string): void {
  agentIdRef = agentId
  tokenRef   = token

  const socket = new WebSocket(wsUrl())
  ws = socket

  let authTimeout: NodeJS.Timeout | null = null

  socket.on('open', () => {
    log.info('Connected to control plane')
    socket.send(JSON.stringify({ type: 'auth', agentId, token }))
    authTimeout = setTimeout(() => {
      log.warn('Auth timeout')
      socket.close()
    }, 10_000)
  })

  socket.on('message', (raw: Buffer) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString())
    } catch {
      return
    }

    const result = LogAgentServerMessageSchema.safeParse(parsed)
    if (!result.success) return
    const msg = result.data

    if (msg.type === 'auth_ok') {
      if (authTimeout) { clearTimeout(authTimeout); authTimeout = null }
      log.info('Authenticated')
      startHeartbeat(agentId)

      stopJournal = startJournal((line, source) => {
        send({
          type:   'log_line',
          vmid:   config.VMID,
          nodeId: config.NODE_ID,
          source,
          unit:   line.unit,
          level:  line.level,
          line:   line.line,
          ts:     line.ts,
        })
      })
    }

    if (msg.type === 'error') {
      log.warn('Error from server', { code: msg.code, message: msg.message })
    }
  })

  socket.on('close', () => {
    log.info('Disconnected, reconnecting...')
    stopHeartbeat()
    stopJournal?.()
    stopJournal = null
    ws = null
    scheduleReconnect()
  })

  socket.on('error', (err: Error) => {
    log.warn('WebSocket error', { error: err.message })
  })
}

export function closeConnection(): void {
  reconnectScheduled = true
  stopHeartbeat()
  stopJournal?.()
  stopJournal = null
  ws?.close()
  ws = null
}
