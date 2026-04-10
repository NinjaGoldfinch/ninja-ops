import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { nodeService } from '../../services/node.js'
import { auditService } from '../../services/audit.js'
import { proxmoxService } from '../../services/proxmox.js'
import { AppError } from '../../errors.js'
import { requireRole } from '../../plugins/rbac.js'

const CreateNodeSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().default(8006),
  tokenId: z.string().min(1),
  tokenSecret: z.string().min(1),
  sshUser: z.string().min(1).default('root'),
  sshPassword: z.string().min(1).optional(),
})

const UpdateNodeSchema = z.object({
  name: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().optional(),
  tokenId: z.string().min(1).optional(),
  tokenSecret: z.string().min(1).optional(),
  sshUser: z.string().min(1).optional(),
  sshPassword: z.string().min(1).optional(),
})

const TestConnectionSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().default(8006),
  tokenId: z.string().min(1),
  // When editing an existing node, tokenSecret may be omitted and nodeId provided instead
  tokenSecret: z.string().min(1).optional(),
  nodeId: z.string().uuid().optional(),
})

function validationError(error: z.ZodError) {
  return AppError.validationError(
    'Invalid request body',
    error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
  )
}

export default async function nodeRoutes(app: FastifyInstance) {
  // GET /api/nodes
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const nodes = await nodeService.list()
    return reply.send({ ok: true, data: nodes })
  })

  // GET /api/nodes/:nodeId
  app.get('/:nodeId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { nodeId } = request.params as { nodeId: string }
    const node = await nodeService.get(nodeId)
    return reply.send({ ok: true, data: node })
  })

  // POST /api/nodes
  app.post(
    '/',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = CreateNodeSchema.safeParse(request.body)
      if (!body.success) throw validationError(body.error)

      const node = await nodeService.create({
        name: body.data.name,
        host: body.data.host,
        port: body.data.port,
        tokenId: body.data.tokenId,
        tokenSecret: body.data.tokenSecret,
        sshUser: body.data.sshUser,
        ...(body.data.sshPassword !== undefined ? { sshPassword: body.data.sshPassword } : {}),
      })
      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'node_create',
        resourceType: 'node',
        resourceId: node.id,
        ip: request.ip,
      })
      return reply.status(201).send({ ok: true, data: node })
    },
  )

  // PUT /api/nodes/:nodeId
  app.put(
    '/:nodeId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string }
      const body = UpdateNodeSchema.safeParse(request.body)
      if (!body.success) throw validationError(body.error)

      const node = await nodeService.update(nodeId, body.data)
      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'node_update',
        resourceType: 'node',
        resourceId: nodeId,
        ip: request.ip,
      })
      return reply.send({ ok: true, data: node })
    },
  )

  // DELETE /api/nodes/:nodeId
  app.delete(
    '/:nodeId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string }
      await nodeService.delete(nodeId)
      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'node_delete',
        resourceType: 'node',
        resourceId: nodeId,
        ip: request.ip,
      })
      return reply.status(204).send()
    },
  )

  // POST /api/nodes/:nodeId/sync
  app.post(
    '/:nodeId/sync',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string }
      const node = await nodeService.syncStatus(nodeId)
      return reply.send({ ok: true, data: node })
    },
  )

  // POST /api/nodes/test  — test connection without saving
  app.post(
    '/test',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = TestConnectionSchema.safeParse(request.body)
      if (!body.success) throw validationError(body.error)

      let tokenSecret = body.data.tokenSecret
      if (!tokenSecret) {
        if (!body.data.nodeId) {
          throw AppError.validationError('tokenSecret or nodeId required', [])
        }
        const stored = await nodeService.getWithSecret(body.data.nodeId)
        tokenSecret = stored.tokenSecret
      }
      await proxmoxService.testConnection({ ...body.data, tokenSecret })
      return reply.send({ ok: true, data: { connected: true } })
    },
  )
}
