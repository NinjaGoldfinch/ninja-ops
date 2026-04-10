import type { FastifyInstance } from 'fastify'
import { AgentRegisterRequestSchema } from '@ninja/types'
import { agentService } from '../../services/agent.js'
import { requireRole } from '../../plugins/rbac.js'
import { AppError } from '../../errors.js'

export default async function agentRoutes(app: FastifyInstance) {
  // POST /api/agents/register
  app.post(
    '/register',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const body = AgentRegisterRequestSchema.safeParse(request.body)
      if (!body.success) {
        throw AppError.validationError(
          'Invalid request body',
          body.error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
        )
      }
      const result = await agentService.register(body.data)
      return reply.status(200).send({ ok: true, data: result })
    },
  )

  // GET /api/agents
  app.get(
    '/',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (_req, reply) => {
      const agents = await agentService.listAgents()
      return reply.send({ ok: true, data: agents })
    },
  )

  // DELETE /api/agents/:agentId
  app.delete(
    '/:agentId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string }
      await agentService.deleteAgent(agentId)
      return reply.status(204).send()
    },
  )
}
