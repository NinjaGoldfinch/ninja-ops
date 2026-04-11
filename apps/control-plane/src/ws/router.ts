import fp from 'fastify-plugin'
import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { ClientMessageSchema } from '@ninja/types'
import { sessionManager } from './session.js'
import { handleAuth } from './handlers/auth.js'
import { handleSubscribeMetrics, handleUnsubscribeMetrics } from './handlers/metrics.js'
import { handleSubscribeDeploy, handleUnsubscribeDeploy } from './handlers/deploy.js'
import {
  handleTerminalOpen,
  handleTerminalInput,
  handleTerminalResize,
  handleTerminalClose,
} from './handlers/terminal.js'
import { handleDiagnosticExec } from './handlers/diagnostic.js'
import { setLogBroadcaster, getLogBuffer } from '../lib/log-interceptor.js'

const AUTH_TIMEOUT_MS = 10_000

export const registerWebSocket = fp(async function wsPlugin(app: FastifyInstance) {
  // Wire log interceptor → session broadcaster
  setLogBroadcaster((entry) => {
    sessionManager.broadcastControlLog(entry.stream, entry.data, entry.ts)
  })

  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket, _req) => {
    const connectionId = randomUUID()
    sessionManager.add(connectionId, socket)

    // Require auth within 10 seconds of connecting
    const authTimer = setTimeout(() => {
      const session = sessionManager.get(connectionId)
      if (!session?.userId) {
        socket.send(JSON.stringify({ type: 'auth_error', message: 'Authentication timeout' }))
        socket.close(1008, 'Unauthorized')
      }
    }, AUTH_TIMEOUT_MS)

    socket.on('message', (raw: Buffer | string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        socket.send(JSON.stringify({ type: 'error', code: 'PARSE_ERROR', message: 'Invalid JSON' }))
        return
      }

      const result = ClientMessageSchema.safeParse(parsed)
      if (!result.success) {
        socket.send(JSON.stringify({ type: 'error', code: 'VALIDATION_ERROR', message: 'Unknown message type' }))
        return
      }

      const msg = result.data
      const session = sessionManager.get(connectionId)

      // Auth message is always allowed
      if (msg.type === 'auth') {
        void handleAuth(connectionId, socket, msg.token).then(() => clearTimeout(authTimer))
        return
      }

      // All other messages require authentication
      if (!session?.userId) {
        socket.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Not authenticated' }))
        return
      }

      switch (msg.type) {
        case 'subscribe_metrics':
          handleSubscribeMetrics(connectionId, msg.nodeId, msg.vmid)
          break
        case 'unsubscribe_metrics':
          handleUnsubscribeMetrics(connectionId, msg.nodeId, msg.vmid)
          break
        case 'subscribe_deploy':
          handleSubscribeDeploy(connectionId, msg.jobId)
          break
        case 'unsubscribe_deploy':
          handleUnsubscribeDeploy(connectionId, msg.jobId)
          break
        case 'terminal_open':
          handleTerminalOpen(socket, msg.sessionId)
          break
        case 'terminal_input':
          handleTerminalInput(msg.sessionId, msg.data)
          break
        case 'terminal_resize':
          handleTerminalResize(msg.sessionId, msg.cols, msg.rows)
          break
        case 'terminal_close':
          handleTerminalClose(msg.sessionId)
          break
        case 'subscribe_logs':
          sessionManager.subscribeLog(connectionId, msg.vmid)
          break
        case 'unsubscribe_logs':
          sessionManager.unsubscribeLog(connectionId, msg.vmid)
          break
        case 'subscribe_control_logs':
          if (session.role === 'admin') {
            sessionManager.subscribeControlLog(connectionId)
            // Replay buffer so the panel isn't blank on open
            for (const entry of getLogBuffer()) {
              socket.send(JSON.stringify({ type: 'control_log', ...entry }))
            }
          } else {
            socket.send(JSON.stringify({ type: 'error', code: 'FORBIDDEN', message: 'Admin role required' }))
          }
          break
        case 'unsubscribe_control_logs':
          sessionManager.unsubscribeControlLog(connectionId)
          break
        case 'diagnostic_exec':
          void handleDiagnosticExec(connectionId, socket, msg)
          break
      }
    })

    socket.on('close', () => {
      clearTimeout(authTimer)
      sessionManager.remove(connectionId)
    })
  })
})
