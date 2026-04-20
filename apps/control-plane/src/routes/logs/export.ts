import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { LogQueryParamsSchema } from '@ninja/types'
import { logService } from '../../services/log.js'
import { AppError } from '../../errors.js'

const ExportQuerySchema = LogQueryParamsSchema.extend({
  format: z.enum(['ndjson', 'csv']).default('ndjson'),
})

export default async function logExportRoute(app: FastifyInstance) {
  // GET /api/logs/export — streaming, do not buffer
  app.get('/export', { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = ExportQuerySchema.safeParse(request.query)
    if (!query.success) {
      throw AppError.validationError(
        'Invalid query parameters',
        query.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
      )
    }

    const { format, ...params } = query.data
    const filename = `logs-export.${format === 'csv' ? 'csv' : 'ndjson'}`
    const contentType = format === 'csv' ? 'text/csv' : 'application/x-ndjson'

    reply.raw.setHeader('Content-Type', contentType)
    reply.raw.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

    await logService.exportStream({ ...params, format }, reply.raw)
  })
}
