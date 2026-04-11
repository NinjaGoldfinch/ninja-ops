import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PowerActionRequestSchema, CreateSnapshotRequestSchema } from '@ninja/types'
import { nodeService } from '../../services/node.js'
import { proxmoxService } from '../../services/proxmox.js'
import { auditService } from '../../services/audit.js'
import { deployAgentIntoLxc, deployLogAgentIntoLxc } from '../../services/agent-deployer.js'
import { JobLogger } from '../../services/job-logger.js'
import { AppError } from '../../errors.js'
import { requireRole } from '../../plugins/rbac.js'

function validationError(error: z.ZodError) {
  return AppError.validationError(
    'Invalid request',
    error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
  )
}

async function getNodeConfig(nodeId: string) {
  const { node, tokenSecret, sshPassword, sshHost, sshAuthMethod, sshPrivateKey, sshKeyPassphrase } = await nodeService.getWithSecret(nodeId)
  return {
    host: node.host,
    port: node.port,
    tokenId: node.tokenId,
    tokenSecret,
    nodeName: node.name,
    sshUser: node.sshUser,
    sshHost,
    sshAuthMethod,
    sshPassword,
    sshPrivateKey,
    sshKeyPassphrase,
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

  // DELETE /api/nodes/:nodeId/guests/:vmid
  app.delete(
    '/:nodeId/guests/:vmid',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { nodeId, vmid: vmidStr } = request.params as { nodeId: string; vmid: string }
      const vmid = parseInt(vmidStr, 10)
      const cfg = await getNodeConfig(nodeId)
      const guest = await resolveGuest(cfg, nodeId, vmid)

      if (guest.status !== 'stopped') {
        throw AppError.validationError('Guest must be stopped before deleting', [])
      }

      await proxmoxService.destroyGuest(cfg, guest.type, vmid)

      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'guest_delete',
        resourceType: 'guest',
        resourceId: `${nodeId}/${vmid}`,
        meta: { name: guest.name, type: guest.type },
        ip: request.ip,
      })

      return reply.status(204).send()
    },
  )

  // POST /api/nodes/:nodeId/guests/:vmid/deploy-agent
  app.post(
    '/:nodeId/guests/:vmid/deploy-agent',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { nodeId, vmid: vmidStr } = request.params as { nodeId: string; vmid: string }
      const vmid = parseInt(vmidStr, 10)
      const cfg = await getNodeConfig(nodeId)
      const guest = await resolveGuest(cfg, nodeId, vmid)

      if (guest.type !== 'lxc') {
        throw AppError.validationError('Agent deployment is only supported for LXC containers', [])
      }

      const logger = new JobLogger('agent_deploy', `${nodeId}/${vmid}`)

      // Fire-and-forget so the client gets the sessionId immediately and can
      // poll for live log updates while the deployment runs in the background.
      void deployAgentIntoLxc(cfg, vmid, nodeId, logger)
        .then(() => logger.info('[agent-deployer] deployment complete\n'))
        .catch((err: unknown) => {
          logger.error(`[agent-deployer] fatal: ${err instanceof Error ? err.message : String(err)}\n`)
        })
        .finally(() => void logger.flush())

      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'agent_deploy',
        resourceType: 'guest',
        resourceId: `${nodeId}/${vmid}`,
        ip: request.ip,
      })

      return reply.send({ ok: true, data: { deployed: true, sessionId: logger.sessionId } })
    },
  )

  // POST /api/nodes/:nodeId/guests/:vmid/deploy-log-agent
  app.post(
    '/:nodeId/guests/:vmid/deploy-log-agent',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { nodeId, vmid: vmidStr } = request.params as { nodeId: string; vmid: string }
      const vmid = parseInt(vmidStr, 10)
      const body = (request.body ?? {}) as { logUnits?: string }
      const logUnits = typeof body.logUnits === 'string' ? body.logUnits : ''

      const cfg = await getNodeConfig(nodeId)
      const guest = await resolveGuest(cfg, nodeId, vmid)

      if (guest.type !== 'lxc') {
        throw AppError.validationError('Log-agent deployment is only supported for LXC containers', [])
      }

      const logger = new JobLogger('log_agent_deploy', `${nodeId}/${vmid}`)
      void deployLogAgentIntoLxc(cfg, vmid, nodeId, logUnits, logger)
        .then(() => logger.info('[log-agent-deployer] deployment complete\n'))
        .catch((err: unknown) => {
          logger.error(`[log-agent-deployer] fatal: ${err instanceof Error ? err.message : String(err)}\n`)
        })
        .finally(() => void logger.flush())

      auditService.log({
        userId: request.user.sub,
        username: request.user.username,
        action: 'log_agent_deploy',
        resourceType: 'guest',
        resourceId: `${nodeId}/${vmid}`,
        ip: request.ip,
      })

      return reply.send({ ok: true, data: { deployed: true, sessionId: logger.sessionId } })
    },
  )
}
