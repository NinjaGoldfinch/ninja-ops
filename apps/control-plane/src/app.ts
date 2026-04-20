import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyError } from 'fastify'
import { config } from './config.js'
import { logger } from './lib/logger.js'
import { AppError } from './errors.js'
import type { ApiError } from '@ninja/types'

import corsPlugin from './plugins/cors.js'
import rateLimitPlugin from './plugins/rate-limit.js'
import authPlugin from './plugins/auth.js'
import swaggerPlugin from './plugins/swagger.js'

import authRoutes from './routes/auth/index.js'
import nodeRoutes from './routes/nodes/index.js'
import guestRoutes from './routes/guests/index.js'
import deployTargetRoutes from './routes/deploy/targets.js'
import deployJobRoutes from './routes/deploy/jobs.js'
import githubWebhookRoutes from './routes/webhooks/github.js'
import agentRoutes from './routes/agents/index.js'
import auditRoutes from './routes/audit/index.js'
import provisioningRoutes from './routes/provisioning/index.js'
import diagnosticsRoutes from './routes/diagnostics/index.js'
import logRoutes from './routes/logs/index.js'
import logAgentRoutes from './routes/log-agents/index.js'
import { registerWebSocket } from './ws/router.js'
import { registerAgentWebSocket } from './ws/agent-router.js'
import { registerLogAgentWebSocket } from './ws/log-agent-router.js'

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
  })

  // Echo request ID back in response headers
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id)
  })

  // Preserve raw body for HMAC verification on webhook routes
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    function (_req, body, done) {
      try {
        const raw = (body as Buffer)
        const str = raw.toString()
        const parsed = str.length > 0 ? JSON.parse(str) as unknown : null
        // Attach raw buffer to request for webhook routes
        const req = _req as { rawBody?: Buffer }
        req.rawBody = raw
        done(null, parsed)
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  // Global error handler — must be registered before route plugins so child scopes inherit it
  app.setErrorHandler((error: FastifyError | AppError | Error, _req, reply) => {
    if (error instanceof AppError) {
      const body: ApiError = {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      }
      return reply.status(error.statusCode).send(body)
    }

    // Fastify validation errors have statusCode 400
    if ('statusCode' in error && error.statusCode === 400) {
      const body: ApiError = {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: error.message,
      }
      return reply.status(400).send(body)
    }

    app.log.error(error)
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Internal server error' }
    return reply.status(500).send(body)
  })

  // Plugins (order matters)
  await app.register(corsPlugin)
  await app.register(rateLimitPlugin)
  await app.register(authPlugin)
  await app.register(swaggerPlugin)

  // Routes
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(nodeRoutes, { prefix: '/api/nodes' })
  await app.register(guestRoutes, { prefix: '/api/nodes' })
  await app.register(deployTargetRoutes, { prefix: '/api/deploy/targets' })
  await app.register(deployJobRoutes, { prefix: '/api/deploy/jobs' })
  await app.register(githubWebhookRoutes, { prefix: '/api/webhooks' })
  await app.register(agentRoutes, { prefix: '/api/agents' })
  await app.register(auditRoutes, { prefix: '/api/audit' })
  await app.register(provisioningRoutes, { prefix: '/api/provisioning' })
  await app.register(diagnosticsRoutes, { prefix: '/api/diagnostics' })
  await app.register(logRoutes, { prefix: '/api/logs' })
  await app.register(logAgentRoutes, { prefix: '/api/log-agents' })

  // WebSocket endpoints
  await app.register(registerWebSocket)
  await app.register(registerAgentWebSocket)
  await app.register(registerLogAgentWebSocket)

  // Health check — no auth required
  app.get('/healthz', async () => ({ ok: true }))

  return app
}
