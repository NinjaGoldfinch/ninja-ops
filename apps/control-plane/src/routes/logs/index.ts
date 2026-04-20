import type { FastifyInstance } from 'fastify'
import { LogQueryParamsSchema } from '@ninja/types'
import { logService } from '../../services/log.js'
import { AppError } from '../../errors.js'
import logStatsRoute from './stats.js'
import logExportRoute from './export.js'
import logFiltersRoute from './filters.js'
import logRetentionRoute from './retention.js'

export default async function logRoutes(app: FastifyInstance) {
  // GET /api/logs
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = LogQueryParamsSchema.safeParse(request.query)
    if (!query.success) {
      throw AppError.validationError(
        'Invalid query parameters',
        query.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
      )
    }
    const result = await logService.query(query.data)
    return reply.send({ ok: true, data: result })
  })

  await app.register(logStatsRoute)
  await app.register(logExportRoute)
  await app.register(logFiltersRoute)
  await app.register(logRetentionRoute)
}
