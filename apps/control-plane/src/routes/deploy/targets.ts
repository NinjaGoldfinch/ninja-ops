import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { deployService } from '../../services/deploy.js'
import { auditService } from '../../services/audit.js'
import { AppError } from '../../errors.js'
import { requireRole } from '../../plugins/rbac.js'

const CreateTargetSchema = z.object({
  repository: z.string().min(1),
  branch: z.string().min(1),
  nodeId: z.string().uuid(),
  vmid: z.number().int().positive(),
  workingDir: z.string().min(1),
  restartCommand: z.string().min(1),
  preDeployCommand: z.string().optional(),
  postDeployCommand: z.string().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
})

const UpdateTargetSchema = CreateTargetSchema.partial()

function validationError(error: z.ZodError) {
  return AppError.validationError(
    'Invalid request body',
    error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
  )
}

export default async function deployTargetRoutes(app: FastifyInstance) {
  // GET /api/deploy/targets
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const targets = await deployService.listTargets()
    return reply.send({ ok: true, data: targets })
  })

  // GET /api/deploy/targets/:targetId
  app.get('/:targetId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { targetId } = request.params as { targetId: string }
    const target = await deployService.getTarget(targetId)
    return reply.send({ ok: true, data: target })
  })

  // POST /api/deploy/targets
  app.post(
    '/',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = CreateTargetSchema.safeParse(request.body)
      if (!body.success) throw validationError(body.error)

      const target = await deployService.createTarget(body.data)
      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'target_create',
        resourceType: 'deploy_target',
        resourceId: target.id,
        ip: request.ip,
      })
      return reply.status(201).send({ ok: true, data: target })
    },
  )

  // PUT /api/deploy/targets/:targetId
  app.put(
    '/:targetId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { targetId } = request.params as { targetId: string }
      const body = UpdateTargetSchema.safeParse(request.body)
      if (!body.success) throw validationError(body.error)

      const target = await deployService.updateTarget(targetId, body.data)
      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'target_update',
        resourceType: 'deploy_target',
        resourceId: targetId,
        ip: request.ip,
      })
      return reply.send({ ok: true, data: target })
    },
  )

  // DELETE /api/deploy/targets/:targetId
  app.delete(
    '/:targetId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { targetId } = request.params as { targetId: string }
      await deployService.deleteTarget(targetId)
      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'target_delete',
        resourceType: 'deploy_target',
        resourceId: targetId,
        ip: request.ip,
      })
      return reply.status(204).send()
    },
  )
}
