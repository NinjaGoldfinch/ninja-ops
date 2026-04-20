import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { AgentClientMessageSchema } from '@ninja/types'
import { verifyToken } from '../plugins/auth.js'
import { agentService } from '../services/agent.js'
import { deployService } from '../services/deploy.js'
import { sessionManager } from './session.js'

export const registerAgentWebSocket = fp(async function agentWsPlugin(app: FastifyInstance) {
  const log = app.log.child({ component: 'ws:agent' })

  app.get('/ws/agent', { websocket: true }, (socket, _req) => {
    let agentId: string | null = null

    log.debug('Agent WebSocket connection opened')

    const authTimer = setTimeout(() => {
      if (!agentId) {
        log.warn('Agent auth timeout, closing connection')
        socket.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Authentication timeout' }))
        socket.close(1008, 'Unauthorized')
      }
    }, 10_000)

    socket.on('message', (raw: Buffer | string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        log.debug('Invalid JSON from agent connection')
        socket.send(JSON.stringify({ type: 'error', code: 'PARSE_ERROR', message: 'Invalid JSON' }))
        return
      }

      const result = AgentClientMessageSchema.safeParse(parsed)
      if (!result.success) {
        log.debug({ issues: result.error.issues }, 'Unknown agent message type')
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
            log.info({ agentId }, 'Agent authenticated')
            socket.send(JSON.stringify({ type: 'auth_ok' }))
          } catch {
            log.warn({ agentId: msg.agentId }, 'Agent auth failed')
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
            log.debug({ agentId, jobId: result.jobId }, 'Deploy started')
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
            log.info({ agentId, jobId: result.jobId, exitCode: result.exitCode, finalState }, 'Deploy finished')
            void deployService.transitionState(result.jobId, finalState, {
              exitCode: result.exitCode,
            })
            void deployService.getJob(result.jobId).then(job => {
              sessionManager.broadcastDeployUpdate(result.jobId, job)
            })
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
            break
        }
      }
    })

    socket.on('close', () => {
      clearTimeout(authTimer)
      if (agentId) {
        log.info({ agentId }, 'Agent WebSocket disconnected')
        agentService.markDisconnected(agentId)
      }
    })
  })
})
