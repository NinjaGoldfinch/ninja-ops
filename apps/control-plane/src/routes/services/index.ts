import type { FastifyInstance } from 'fastify'
import { EnqueueServiceRedeploySchema } from '@ninja/types'
import { getServiceVersions } from '../../services/service-versions.js'
import { serviceRedeployService } from '../../services/service-redeploy.js'
import { getJobSessions, getSessionLogs } from '../../services/job-logger.js'
import { requireRole } from '../../plugins/rbac.js'
import { AppError } from '../../errors.js'

export default async function serviceRoutes(app: FastifyInstance) {
  // GET /api/services/versions — operator+
  app.get(
    '/versions',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (_req, reply) => {
      const versions = await getServiceVersions()
      return reply.send({ ok: true, data: versions })
    },
  )

  // POST /api/services/:service/redeploy — admin only
  app.post(
    '/:service/redeploy',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { service } = request.params as { service: string }
      const parsed = EnqueueServiceRedeploySchema.safeParse({
        service,
        ...(request.body as object),
      })
      if (!parsed.success) {
        throw AppError.validationError(
          'Invalid request',
          parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
            path: i.path.map(String),
            message: i.message,
          })),
        )
      }
      const job = await serviceRedeployService.enqueue(parsed.data)
      return reply.status(201).send({ ok: true, data: job })
    },
  )

  // GET /api/services/redeploy-jobs — admin only
  app.get(
    '/redeploy-jobs',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const query = request.query as { service?: string; limit?: string }
      const filter: { service?: 'control-plane' | 'dashboard'; limit?: number } = {}
      if (query.service === 'control-plane' || query.service === 'dashboard') {
        filter.service = query.service
      }
      if (query.limit !== undefined) filter.limit = parseInt(query.limit, 10)
      const jobs = await serviceRedeployService.listJobs(filter)
      return reply.send({ ok: true, data: jobs })
    },
  )

  // GET /api/services/redeploy-jobs/:jobId — admin only
  app.get(
    '/redeploy-jobs/:jobId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string }
      const job = await serviceRedeployService.getJob(jobId)
      return reply.send({ ok: true, data: job })
    },
  )

  // POST /api/services/redeploy-jobs/:jobId/cancel — admin only
  app.post(
    '/redeploy-jobs/:jobId/cancel',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string }
      const job = await serviceRedeployService.cancel(jobId)
      return reply.send({ ok: true, data: job })
    },
  )

  // GET /api/services/redeploy-jobs/:jobId/logs — admin only
  app.get(
    '/redeploy-jobs/:jobId/logs',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string }
      // Verify the job exists
      await serviceRedeployService.getJob(jobId)
      const sessions = await getJobSessions('service_redeploy', jobId)
      if (!sessions.length) return reply.send({ ok: true, data: [] })
      const logs = await getSessionLogs(sessions[0]!.sessionId)
      return reply.send({ ok: true, data: logs })
    },
  )
}
