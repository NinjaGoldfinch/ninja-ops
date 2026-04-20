import type { FastifyInstance } from 'fastify'
import { LogStatsParamsSchema } from '@ninja/types'
import { logService } from '../../services/log.js'
import { AppError } from '../../errors.js'

export default async function logStatsRoute(app: FastifyInstance) {
  // GET /api/logs/stats
  app.get('/stats', { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = LogStatsParamsSchema.safeParse(request.query)
    if (!query.success) {
      throw AppError.validationError(
        'Invalid query parameters',
        query.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
      )
    }
    const result = await logService.getStats(query.data)
    return reply.send({ ok: true, data: result })
  })
}
