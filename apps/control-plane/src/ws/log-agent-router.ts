import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { LogAgentClientMessageSchema } from '@ninja/types'
import { verifyToken } from '../plugins/auth.js'
import { logService } from '../services/log.js'
import { agentService } from '../services/agent.js'

export const registerLogAgentWebSocket = fp(async function logAgentWsPlugin(app: FastifyInstance) {
  const log = app.log.child({ component: 'ws:log-agent' })

  app.get('/ws/log-agent', { websocket: true }, (socket, _req) => {
    let agentId: string | null = null

    log.debug('Log-agent WebSocket connection opened')

    const authTimeout = setTimeout(() => {
      if (!agentId) {
        log.warn('Log-agent auth timeout, closing connection')
        socket.close(1008, 'Unauthorized')
      }
    }, 10_000)

    socket.on('message', (raw: Buffer) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        log.debug('Invalid JSON from log-agent connection')
        return
      }

      const result = LogAgentClientMessageSchema.safeParse(parsed)
      if (!result.success) {
        log.debug({ issues: result.error.issues }, 'Invalid log-agent message')
        return
      }

      const msg = result.data

      if (msg.type === 'auth') {
        void (async () => {
          try {
            const payload = await verifyToken(msg.token)
            if (payload.sub !== msg.agentId) throw new Error('sub mismatch')
            agentId = msg.agentId
            clearTimeout(authTimeout)
            agentService.markConnected(agentId, socket)
            log.info({ agentId }, 'Log-agent authenticated')
            socket.send(JSON.stringify({ type: 'auth_ok' }))
          } catch {
            log.warn({ agentId: msg.agentId }, 'Log-agent auth failed')
            socket.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Invalid token' }))
            socket.close(1008, 'Unauthorized')
          }
        })()
        return
      }

      if (!agentId) {
        log.debug('Message from unauthenticated log-agent')
        return
      }

      if (msg.type === 'heartbeat') {
        void agentService.handleHeartbeat({
          agentId: msg.agentId,
          status: 'idle',
          currentJobId: null,
          timestamp: msg.ts,
        })
        return
      }

      if (msg.type === 'log_line') {
        logService.ingest(msg)
      }
    })

    socket.on('close', () => {
      clearTimeout(authTimeout)
      if (agentId) {
        log.info({ agentId }, 'Log-agent WebSocket disconnected')
        agentService.markDisconnected(agentId)
      }
    })
  })
})
