import Fastify from 'fastify'
import { config } from './config.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' } }
        : {}),
    },
  })

  // Health check — no auth required
  app.get('/healthz', async () => ({ ok: true }))

  return app
}
