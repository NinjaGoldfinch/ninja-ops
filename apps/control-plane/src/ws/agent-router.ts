import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { AgentClientMessageSchema } from '@ninja/types'
import { verifyToken } from '../plugins/auth.js'
import { agentService } from '../services/agent.js'
import { deployService } from '../services/deploy.js'
import { sessionManager } from './session.js'

export const registerAgentWebSocket = fp(async function agentWsPlugin(app: FastifyInstance) {
  // @fastify/websocket is already registered by the browser WS router.
  // Just add the route:

  app.get('/ws/agent', { websocket: true }, (socket, _req) => {
    let agentId: string | null = null

    const authTimer = setTimeout(() => {
      if (!agentId) {
        socket.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Authentication timeout' }))
        socket.close(1008, 'Unauthorized')
      }
    }, 10_000)

    socket.on('message', (raw: Buffer | string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        socket.send(JSON.stringify({ type: 'error', code: 'PARSE_ERROR', message: 'Invalid JSON' }))
        return
      }

      const result = AgentClientMessageSchema.safeParse(parsed)
      if (!result.success) {
        socket.send(JSON.stringify({ type: 'error', code: 'VALIDATION_ERROR', message: 'Unknown message type' }))
        return
      }

      const msg = result.data

      if (msg.type === 'auth') {
        void (async () => {
          try {
            const payload = await verifyToken(msg.token)
            if (payload.sub !== msg.agentId) {
              throw new Error('Token subject does not match agentId')
            }
            agentId = msg.agentId
            clearTimeout(authTimer)
            agentService.markConnected(agentId, socket)
            socket.send(JSON.stringify({ type: 'auth_ok' }))
          } catch {
            socket.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Invalid token' }))
            socket.close(1008, 'Unauthorized')
          }
        })()
        return
      }

      if (!agentId) {
        socket.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Not authenticated' }))
        return
      }

      if (msg.type === 'heartbeat') {
        void agentService.handleHeartbeat(msg.payload)
        return
      }

      if (msg.type === 'result') {
        const result = msg.payload
        switch (result.type) {
          case 'deploy_started':
            void deployService.transitionState(result.jobId, 'running', { agentId: result.agentId })
            void deployService.getJob(result.jobId).then(job => {
              sessionManager.broadcastDeployUpdate(result.jobId, job)
            })
            break

          case 'deploy_log': {
            const logLine = {
              jobId: result.jobId,
              seq: result.seq,
              stream: result.stream,
              line: result.line,
            }
            void deployService.appendLogLine(logLine)
            sessionManager.broadcastDeployLog(result.jobId, {
              ...logLine,
              timestamp: result.timestamp,
            })
            break
          }

          case 'deploy_finished': {
            const finalState = result.exitCode === 0 ? 'success' : 'failed'
            void deployService.transitionState(result.jobId, finalState, {
              exitCode: result.exitCode,
            })
            void deployService.getJob(result.jobId).then(job => {
              sessionManager.broadcastDeployUpdate(result.jobId, job)
            })
            // Mark agent as idle
            if (agentId) {
              void agentService.handleHeartbeat({
                agentId,
                status: 'idle',
                currentJobId: null,
                timestamp: new Date().toISOString(),
              })
            }
            break
          }

          case 'pong':
            // Heartbeat response — no action needed
            break
        }
      }
    })

    socket.on('close', () => {
      clearTimeout(authTimer)
      if (agentId) {
        agentService.markDisconnected(agentId)
      }
    })
  })
})
