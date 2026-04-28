import type { FastifyInstance } from 'fastify'
import { EnqueueAllRequestSchema } from '@ninja/types'
import { agentRedeployService } from '../../services/agent-redeploy.js'
import { getBundleVersions } from '../../services/bundle-versions.js'
import { requireRole } from '../../plugins/rbac.js'
import { AppError } from '../../errors.js'

export default async function redeployRoutes(app: FastifyInstance) {
  // GET /api/agents/bundle-info — operator+
  app.get(
    '/bundle-info',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (_req, reply) => {
      return reply.send({ ok: true, data: getBundleVersions() })
    },
  )

  // POST /api/agents/:agentId/redeploy — admin only
  app.post(
    '/:agentId/redeploy',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string }
      const job = await agentRedeployService.enqueueOne(agentId)
      return reply.status(201).send({ ok: true, data: job })
    },
  )

  // POST /api/agents/redeploy-all — admin only
  app.post(
    '/redeploy-all',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const parsed = EnqueueAllRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw AppError.validationError(
          'Invalid request body',
          parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
            path: i.path.map(String),
            message: i.message,
          })),
        )
      }
      const jobs = await agentRedeployService.enqueueAll(parsed.data)
      return reply.status(201).send({ ok: true, data: jobs })
    },
  )

  // GET /api/agents/redeploy-jobs — admin only
  app.get(
    '/redeploy-jobs',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const query = request.query as { agentId?: string; limit?: string }
      const filter: { agentId?: string; limit?: number } = {}
      if (query.agentId !== undefined) filter.agentId = query.agentId
      if (query.limit !== undefined) filter.limit = parseInt(query.limit, 10)
      const jobs = await agentRedeployService.listJobs(filter)
      return reply.send({ ok: true, data: jobs })
    },
  )

  // GET /api/agents/redeploy-jobs/:jobId — admin only
  app.get(
    '/redeploy-jobs/:jobId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string }
      const job = await agentRedeployService.getJob(jobId)
      return reply.send({ ok: true, data: job })
    },
  )

  // POST /api/agents/redeploy-jobs/:jobId/cancel — admin only
  app.post(
    '/redeploy-jobs/:jobId/cancel',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string }
      const job = await agentRedeployService.cancel(jobId)
      return reply.send({ ok: true, data: job })
    },
  )
}
