import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { LogAgentClientMessageSchema } from '@ninja/types'
import { verifyToken } from '../plugins/auth.js'
import { logService } from '../services/log.js'
import { agentService } from '../services/agent.js'

export const registerLogAgentWebSocket = fp(async function logAgentWsPlugin(app: FastifyInstance) {
  app.get('/ws/log-agent', { websocket: true }, (socket, _req) => {
    let agentId: string | null = null

    const authTimeout = setTimeout(() => {
      if (!agentId) socket.close(1008, 'Unauthorized')
    }, 10_000)

    socket.on('message', (raw: Buffer) => {
      let parsed: unknown
      try { parsed = JSON.parse(raw.toString()) } catch { return }

      const result = LogAgentClientMessageSchema.safeParse(parsed)
      if (!result.success) return

      const msg = result.data

      if (msg.type === 'auth') {
        void (async () => {
          try {
            const payload = await verifyToken(msg.token)
            if (payload.sub !== msg.agentId) throw new Error('sub mismatch')
            agentId = msg.agentId
            clearTimeout(authTimeout)
            agentService.markConnected(agentId, socket)
            socket.send(JSON.stringify({ type: 'auth_ok' }))
          } catch {
            socket.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Invalid token' }))
            socket.close(1008, 'Unauthorized')
          }
        })()
        return
      }

      if (!agentId) return

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
      if (agentId) agentService.markDisconnected(agentId)
    })
  })
})
