import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { LogAgentRegisterRequestSchema } from '@ninja/types'
import { agentService } from '../../services/agent.js'
import { AppError } from '../../errors.js'
import { config } from '../../config.js'

export default async function logAgentRoutes(app: FastifyInstance) {
  // POST /api/log-agents/register
  app.post(
    '/register',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const body = LogAgentRegisterRequestSchema.safeParse(request.body)
      if (!body.success) {
        throw AppError.validationError(
          'Invalid request body',
          body.error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
        )
      }
      const result = await agentService.register({ ...body.data, kind: 'log' })
      return reply.status(200).send({ ok: true, data: result })
    },
  )

  // GET /api/log-agents/download — serves the compiled log-agent bundle (no auth)
  app.get(
    '/download',
    async (_req, reply) => {
      const bundlePath = config.LOG_AGENT_BUNDLE_PATH
      if (!fs.existsSync(bundlePath)) {
        throw AppError.notFound('Log-agent bundle')
      }
      const stream = fs.createReadStream(bundlePath)
      return reply
        .header('Content-Type', 'application/gzip')
        .header('Content-Disposition', 'attachment; filename="log-agent.tar.gz"')
        .send(stream)
    },
  )
}
