import type { ClientMessage, ServerMessage } from '@ninja/types'
import { useAuthStore } from '@/stores/auth'

type MessageHandler = (msg: ServerMessage) => void

interface Subscription {
  type: string
  handler: MessageHandler
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]

let socket: WebSocket | null = null
let subscriptions: Subscription[] = []
let reconnectAttempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let isIntentionallyClosed = false

function getWsUrl(): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  if (base) {
    return base.replace(/^http/, 'ws') + '/ws'
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

function dispatch(msg: ServerMessage): void {
  for (const sub of subscriptions) {
    if (sub.type === msg.type) {
      sub.handler(msg)
    }
  }
}

function scheduleReconnect(): void {
  if (isIntentionallyClosed) return
  const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)] ?? 30000
  reconnectAttempt++
  reconnectTimer = setTimeout(() => {
    ws.connect()
  }, delay)
}

function doConnect(): void {
  const { token, logout } = useAuthStore.getState()
  if (!token) return

  socket = new WebSocket(getWsUrl())

  socket.addEventListener('open', () => {
    reconnectAttempt = 0
    ws.send({ type: 'auth', token })
  })

  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data as string) as ServerMessage
      if (msg.type === 'auth_error') {
        logout()
        return
      }
      dispatch(msg)
    } catch {
      // ignore malformed messages
    }
  })

  socket.addEventListener('close', () => {
    socket = null
    scheduleReconnect()
  })

  socket.addEventListener('error', () => {
    socket?.close()
  })
}

export const ws = {
  connect(): void {
    isIntentionallyClosed = false
    if (socket?.readyState === WebSocket.OPEN) return
    doConnect()
  },

  disconnect(): void {
    isIntentionallyClosed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    socket?.close()
    socket = null
    subscriptions = []
  },

  send(msg: ClientMessage): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg))
    }
  },

  on(type: string, handler: MessageHandler): () => void {
    const sub: Subscription = { type, handler }
    subscriptions.push(sub)
    return () => {
      subscriptions = subscriptions.filter((s) => s !== sub)
    }
  },

  isConnected(): boolean {
    return socket?.readyState === WebSocket.OPEN
  },
}
