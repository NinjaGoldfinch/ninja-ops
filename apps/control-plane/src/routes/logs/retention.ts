import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { sql } from '../../db/client.js'
import { AppError } from '../../errors.js'
import { config } from '../../config.js'
import { requireRole } from '../../plugins/rbac.js'

const RetentionBodySchema = z.object({
  retentionDays: z.number().int().min(1).max(365),
})

export default async function logRetentionRoute(app: FastifyInstance) {
  // GET /api/logs/retention — viewer+
  app.get('/retention', { preHandler: [app.authenticate] }, async (_request, reply) => {
    const [row] = await sql<[{ value: { retentionDays: number } }?]>`
      SELECT value FROM settings WHERE key = 'log_retention_days'
    `
    const retentionDays = row?.value?.retentionDays ?? config.LOG_RETENTION_DAYS
    return reply.send({ ok: true, data: { retentionDays } })
  })

  // PUT /api/logs/retention — admin only
  app.put('/retention', { preHandler: [app.authenticate, requireRole('admin')] }, async (request, reply) => {
    const body = RetentionBodySchema.safeParse(request.body)
    if (!body.success) {
      throw AppError.validationError(
        'Invalid retention body',
        body.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
      )
    }
    const { retentionDays } = body.data
    await sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('log_retention_days', ${JSON.stringify({ retentionDays })}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `
    return reply.send({ ok: true, data: { retentionDays } })
  })
}
