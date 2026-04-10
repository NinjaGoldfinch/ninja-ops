import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PowerActionRequestSchema, CreateSnapshotRequestSchema } from '@ninja/types'
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

async function resolveGuest(cfg: Awaited<ReturnType<typeof getNodeConfig>>, nodeId: string, vmid: number) {
  const guests = await proxmoxService.listGuests(cfg, nodeId)
  const guest = guests.find(g => g.vmid === vmid)
  if (!guest) throw AppError.notFound(`Guest ${vmid}`)
  return guest
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

  // GET /api/nodes/:nodeId/guests/:vmid
  app.get(
    '/:nodeId/guests/:vmid',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { nodeId, vmid: vmidStr } = request.params as { nodeId: string; vmid: string }
      const cfg = await getNodeConfig(nodeId)
      const guest = await resolveGuest(cfg, nodeId, parseInt(vmidStr, 10))
      return reply.send({ ok: true, data: guest })
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

      const cfg = await getNodeConfig(nodeId)
      const guest = await resolveGuest(cfg, nodeId, vmid)
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

  // GET /api/nodes/:nodeId/guests/:vmid/snapshots
  app.get(
    '/:nodeId/guests/:vmid/snapshots',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { nodeId, vmid: vmidStr } = request.params as { nodeId: string; vmid: string }
      const vmid = parseInt(vmidStr, 10)
      const cfg = await getNodeConfig(nodeId)
      const guest = await resolveGuest(cfg, nodeId, vmid)
      const snapshots = await proxmoxService.listSnapshots(cfg, guest.type, vmid)
      return reply.send({ ok: true, data: snapshots })
    },
  )

  // POST /api/nodes/:nodeId/guests/:vmid/snapshots
  app.post(
    '/:nodeId/guests/:vmid/snapshots',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const { nodeId, vmid: vmidStr } = request.params as { nodeId: string; vmid: string }
      const vmid = parseInt(vmidStr, 10)

      const body = CreateSnapshotRequestSchema.safeParse(request.body)
      if (!body.success) throw validationError(body.error)

      const cfg = await getNodeConfig(nodeId)
      const guest = await resolveGuest(cfg, nodeId, vmid)
      await proxmoxService.createSnapshot(cfg, guest.type, vmid, body.data)

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

  // DELETE /api/nodes/:nodeId/guests/:vmid/snapshots/:name
  app.delete(
    '/:nodeId/guests/:vmid/snapshots/:name',
    { preHandler: [app.authenticate, requireRole('operator')] },
    async (request, reply) => {
      const { nodeId, vmid: vmidStr, name } = request.params as {
        nodeId: string
        vmid: string
        name: string
      }
      const vmid = parseInt(vmidStr, 10)
      const cfg = await getNodeConfig(nodeId)
      const guest = await resolveGuest(cfg, nodeId, vmid)
      await proxmoxService.deleteSnapshot(cfg, guest.type, vmid, name)

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
