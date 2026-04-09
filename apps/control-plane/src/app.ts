import Fastify, { type FastifyError } from 'fastify'
import { config } from './config.js'
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
import auditRoutes from './routes/audit/index.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' } }
        : {}),
    },
  })

  // Preserve raw body for HMAC verification on webhook routes
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    function (_req, body, done) {
      try {
        const parsed = JSON.parse((body as Buffer).toString()) as unknown
        // Attach raw buffer to request for webhook routes
        const req = _req as { rawBody?: Buffer }
        req.rawBody = body as Buffer
        done(null, parsed)
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

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
  await app.register(auditRoutes, { prefix: '/api/audit' })

  // Health check — no auth required
  app.get('/healthz', async () => ({ ok: true }))

  // Global error handler
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

  return app
}
