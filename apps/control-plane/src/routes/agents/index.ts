import type { FastifyInstance } from 'fastify'
import { agentService } from '../../services/agent.js'
import { requireRole } from '../../plugins/rbac.js'

export default async function agentRoutes(app: FastifyInstance) {
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
