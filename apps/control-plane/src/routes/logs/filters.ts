import type { FastifyInstance } from 'fastify'
import { CreateSavedLogFilterSchema } from '@ninja/types'
import { sql } from '../../db/client.js'
import { AppError } from '../../errors.js'

interface DbSavedFilter {
  id: string
  name: string
  filter: unknown
  created_at: string
}

export default async function logFiltersRoute(app: FastifyInstance) {
  // GET /api/logs/filters — list caller's saved filters
  app.get('/filters', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub
    const rows = await sql<DbSavedFilter[]>`
      SELECT id, name, filter, created_at
      FROM   log_saved_filters
      WHERE  user_id = ${userId}
      ORDER  BY created_at DESC
    `
    const data = rows.map((r) => ({
      id:        r.id,
      name:      r.name,
      filter:    r.filter,
      createdAt: r.created_at,
    }))
    return reply.send({ ok: true, data })
  })

  // POST /api/logs/filters — create a saved filter
  app.post('/filters', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = CreateSavedLogFilterSchema.safeParse(request.body)
    if (!body.success) {
      throw AppError.validationError(
        'Invalid filter body',
        body.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
      )
    }
    const userId = request.user.sub
    const [row] = await sql<DbSavedFilter[]>`
      INSERT INTO log_saved_filters (user_id, name, filter)
      VALUES (${userId}, ${body.data.name}, ${JSON.stringify(body.data.filter)})
      RETURNING id, name, filter, created_at
    `
    if (!row) throw AppError.internal('Failed to create filter')
    return reply.status(201).send({
      ok: true,
      data: { id: row.id, name: row.name, filter: row.filter, createdAt: row.created_at },
    })
  })

  // DELETE /api/logs/filters/:id — delete (verify ownership)
  app.delete('/filters/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = request.user.sub
    const result = await sql`
      DELETE FROM log_saved_filters WHERE id = ${id} AND user_id = ${userId}
    `
    if (result.count === 0) throw AppError.filterNotFound()
    return reply.status(204).send()
  })
}
