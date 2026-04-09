import type { FastifyInstance } from 'fastify'
import { PaginationQuerySchema } from '@ninja/types'
import { auditService } from '../../services/audit.js'
import { requireRole } from '../../plugins/rbac.js'

export default async function auditRoutes(app: FastifyInstance) {
  // GET /api/audit
  app.get(
    '/',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const query = PaginationQuerySchema.parse(request.query)
      const result = await auditService.list(query)
      return reply.send({
        ok: true,
        data: {
          items: result.items,
          total: result.total,
          page: query.page,
          limit: query.limit,
          hasMore: query.page * query.limit < result.total,
        },
      })
    },
  )
}
