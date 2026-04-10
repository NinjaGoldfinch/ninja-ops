import type { FastifyInstance } from 'fastify'
import { LxcCreateRequestSchema, QemuCreateRequestSchema } from '@ninja/types'
import { provisioningService } from '../../services/provisioning.js'
import { auditService } from '../../services/audit.js'
import { requireRole } from '../../plugins/rbac.js'
import { AppError } from '../../errors.js'

export default async function provisioningRoutes(app: FastifyInstance) {
  // GET /api/provisioning/jobs
  app.get(
    '/jobs',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = request.query as { nodeId?: string }
      const jobs = await provisioningService.listJobs(query.nodeId)
      return reply.send({ ok: true, data: jobs })
    },
  )

  // GET /api/provisioning/jobs/:jobId
  app.get(
    '/jobs/:jobId',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string }
      const job = await provisioningService.getJob(jobId)
      return reply.send({ ok: true, data: job })
    },
  )

  // POST /api/provisioning/lxc
  app.post(
    '/lxc',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = LxcCreateRequestSchema.safeParse(request.body)
      if (!body.success) {
        throw AppError.validationError(
          'Invalid request body',
          body.error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
        )
      }
      const job = await provisioningService.create(body.data)
      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'provision_lxc',
        resourceType: 'provisioning_job',
        resourceId: job.id,
        ip: request.ip,
        meta: { nodeId: body.data.nodeId, hostname: body.data.hostname },
      })
      return reply.status(201).send({ ok: true, data: job })
    },
  )

  // POST /api/provisioning/qemu
  app.post(
    '/qemu',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = QemuCreateRequestSchema.safeParse(request.body)
      if (!body.success) {
        throw AppError.validationError(
          'Invalid request body',
          body.error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
        )
      }
      const job = await provisioningService.create(body.data)
      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'provision_qemu',
        resourceType: 'provisioning_job',
        resourceId: job.id,
        ip: request.ip,
        meta: { nodeId: body.data.nodeId, name: body.data.name },
      })
      return reply.status(201).send({ ok: true, data: job })
    },
  )

  // DELETE /api/provisioning/jobs/:jobId
  app.delete(
    '/jobs/:jobId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string }
      await provisioningService.deleteJob(jobId)
      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'provision_delete',
        resourceType: 'provisioning_job',
        resourceId: jobId,
        ip: request.ip,
      })
      return reply.status(204).send()
    },
  )

  // GET /api/provisioning/nodes/:nodeId/templates
  app.get(
    '/nodes/:nodeId/templates',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string }
      const templates = await provisioningService.discoverTemplates(nodeId)
      return reply.send({ ok: true, data: templates })
    },
  )

  // GET /api/provisioning/nodes/:nodeId/isos
  app.get(
    '/nodes/:nodeId/isos',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string }
      const isos = await provisioningService.discoverIsos(nodeId)
      return reply.send({ ok: true, data: isos })
    },
  )

  // GET /api/provisioning/nodes/:nodeId/storages
  app.get(
    '/nodes/:nodeId/storages',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string }
      const storages = await provisioningService.discoverStorages(nodeId)
      return reply.send({ ok: true, data: storages })
    },
  )
}
