import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { GuestTypeSchema, PowerActionRequestSchema, CreateSnapshotRequestSchema } from '@ninja/types'
import { nodeService } from '../../services/node.js'
import { proxmoxService } from '../../services/proxmox.js'
import { auditService } from '../../services/audit.js'
import { AppError } from '../../errors.js'
import { requireRole } from '../../plugins/rbac.js'

function validationError(error: z.ZodError) {
  return AppError.validationError(
    'Invalid request',
    error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
  )
}

async function getNodeConfig(nodeId: string) {
  const { node, tokenSecret } = await nodeService.getWithSecret(nodeId)
  return {
    host: node.host,
    port: node.port,
    tokenId: node.tokenId,
    tokenSecret,
    nodeName: node.name,
  }
}

export default async function guestRoutes(app: FastifyInstance) {
  // GET /api/nodes/:nodeId/guests
  app.get(
    '/:nodeId/guests',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string }
      const cfg = await getNodeConfig(nodeId)
      const guests = await proxmoxService.listGuests(cfg, nodeId)
      return reply.send({ ok: true, data: guests })
    },
  )

  // POST /api/nodes/:nodeId/guests/:vmid/power
  app.post(
    '/:nodeId/guests/:vmid/power',
    {
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      preHandler: [app.authenticate, requireRole('operator')],
    },
    async (request, reply) => {
      const { nodeId, vmid: vmidStr } = request.params as { nodeId: string; vmid: string }
      const vmid = parseInt(vmidStr, 10)

      const body = PowerActionRequestSchema.safeParse(request.body)
      if (!body.success) throw validationError(body.error)

      // Determine guest type from listing
      const cfg = await getNodeConfig(nodeId)
      const guests = await proxmoxService.listGuests(cfg, nodeId)
      const guest = guests.find(g => g.vmid === vmid)
      if (!guest) throw AppError.notFound(`Guest ${vmid}`)

      await proxmoxService.powerAction(cfg, guest.type, vmid, body.data.action)

      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'guest_power',
        resourceType: 'guest',
        resourceId: `${nodeId}/${vmid}`,
        meta: { action: body.data.action },
        ip: request.ip,
      })

      return reply.send({ ok: true, data: { vmid, action: body.data.action } })
    },
  )

  // GET /api/nodes/:nodeId/guests/:type/:vmid/snapshots
  app.get(
    '/:nodeId/guests/:type/:vmid/snapshots',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { nodeId, type: typeStr, vmid: vmidStr } = request.params as {
        nodeId: string
        type: string
        vmid: string
      }
      const typeResult = GuestTypeSchema.safeParse(typeStr)
      if (!typeResult.success) throw AppError.validationError('Invalid guest type', [])

      const vmid = parseInt(vmidStr, 10)
      const cfg = await getNodeConfig(nodeId)
      const snapshots = await proxmoxService.listSnapshots(cfg, typeResult.data, vmid)
      return reply.send({ ok: true, data: snapshots })
    },
  )

  // POST /api/nodes/:nodeId/guests/:type/:vmid/snapshots
  app.post(
    '/:nodeId/guests/:type/:vmid/snapshots',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const { nodeId, type: typeStr, vmid: vmidStr } = request.params as {
        nodeId: string
        type: string
        vmid: string
      }
      const typeResult = GuestTypeSchema.safeParse(typeStr)
      if (!typeResult.success) throw AppError.validationError('Invalid guest type', [])

      const vmid = parseInt(vmidStr, 10)
      const body = CreateSnapshotRequestSchema.safeParse(request.body)
      if (!body.success) throw validationError(body.error)

      const cfg = await getNodeConfig(nodeId)
      await proxmoxService.createSnapshot(cfg, typeResult.data, vmid, body.data)

      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'snapshot_create',
        resourceType: 'guest',
        resourceId: `${nodeId}/${vmid}`,
        meta: { name: body.data.name },
        ip: request.ip,
      })

      return reply.status(201).send({ ok: true, data: { name: body.data.name } })
    },
  )

  // DELETE /api/nodes/:nodeId/guests/:type/:vmid/snapshots/:name
  app.delete(
    '/:nodeId/guests/:type/:vmid/snapshots/:name',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const { nodeId, type: typeStr, vmid: vmidStr, name } = request.params as {
        nodeId: string
        type: string
        vmid: string
        name: string
      }
      const typeResult = GuestTypeSchema.safeParse(typeStr)
      if (!typeResult.success) throw AppError.validationError('Invalid guest type', [])

      const vmid = parseInt(vmidStr, 10)
      const cfg = await getNodeConfig(nodeId)
      await proxmoxService.deleteSnapshot(cfg, typeResult.data, vmid, name)

      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'snapshot_delete',
        resourceType: 'guest',
        resourceId: `${nodeId}/${vmid}`,
        meta: { name },
        ip: request.ip,
      })

      return reply.status(204).send()
    },
  )
}
