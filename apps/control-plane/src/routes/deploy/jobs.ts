import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { DeployStateSchema } from '@ninja/types'
import { deployService } from '../../services/deploy.js'
import { auditService } from '../../services/audit.js'
import { AppError } from '../../errors.js'
import { requireRole } from '../../plugins/rbac.js'
import { getDeployQueue } from '../../workers/deploy-runner.js'

const TriggerJobSchema = z.object({
  targetId: z.string().uuid(),
})

function validationError(error: z.ZodError) {
  return AppError.validationError(
    'Invalid request',
    error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
  )
}

export default async function deployJobRoutes(app: FastifyInstance) {
  // GET /api/deploy/jobs
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const rawQuery = request.query as Record<string, string>
    const targetId = rawQuery['targetId']
    const stateRaw = rawQuery['state']
    const state = stateRaw !== undefined
      ? DeployStateSchema.parse(stateRaw)
      : undefined
    const limit = rawQuery['limit'] !== undefined ? parseInt(rawQuery['limit'], 10) : undefined

    const jobs = await deployService.listJobs({ targetId, state, limit })
    return reply.send({ ok: true, data: jobs })
  })

  // GET /api/deploy/jobs/:jobId
  app.get('/:jobId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string }
    const job = await deployService.getJob(jobId)
    return reply.send({ ok: true, data: job })
  })

  // POST /api/deploy/jobs  — manual trigger
  app.post(
    '/',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const body = TriggerJobSchema.safeParse(request.body)
      if (!body.success) throw validationError(body.error)

      const job = await deployService.triggerDeploy(body.data.targetId, {
        source: 'manual',
        userId: request.user.sub,
        username: request.user.username,
      })

      await getDeployQueue().add('deploy', { jobId: job.id })

      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'deploy_trigger',
        resourceType: 'deploy_job',
        resourceId: job.id,
        meta: { targetId: body.data.targetId },
        ip: request.ip,
      })

      return reply.status(201).send({ ok: true, data: job })
    },
  )

  // DELETE /api/deploy/jobs/:jobId  — cancel
  app.delete(
    '/:jobId',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string }
      await deployService.cancelJob(jobId)

      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'deploy_cancel',
        resourceType: 'deploy_job',
        resourceId: jobId,
        ip: request.ip,
      })

      return reply.status(204).send()
    },
  )

  // GET /api/deploy/jobs/:jobId/logs
  app.get('/:jobId/logs', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string }
    const lines = await deployService.getJobLogs(jobId)
    return reply.send({ ok: true, data: lines })
  })
}
