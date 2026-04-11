import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sql } from '../../db/client.js'
import { redis } from '../../db/redis.js'
import { nodeService } from '../../services/node.js'
import { proxmoxService } from '../../services/proxmox.js'
import { getSessionLogs, getJobSessions } from '../../services/job-logger.js'
import { AppError } from '../../errors.js'
import { requireRole } from '../../plugins/rbac.js'
import { Client as SshClient } from 'ssh2'
import { resolveSecret } from '../../lib/onepassword.js'

const TestSshSchema = z.object({
  nodeId: z.string().uuid(),
})

export default async function diagnosticsRoutes(app: FastifyInstance) {
  // GET /api/diagnostics/health — overall system health check
  app.get(
    '/health',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (_req, reply) => {
      // DB check
      let dbStatus: 'ok' | 'error' = 'ok'
      try {
        await sql`SELECT 1`
      } catch {
        dbStatus = 'error'
      }

      // Redis check
      let redisStatus: 'ok' | 'error' = 'ok'
      try {
        await redis.ping()
      } catch {
        redisStatus = 'error'
      }

      // Nodes check — test API connectivity and SSH connectivity in parallel
      const nodes = await nodeService.list()
      const nodeResults = await Promise.all(
        nodes.map(async (node) => {
          let apiStatus: 'ok' | 'error' = 'ok'
          let sshStatus: 'ok' | 'error' | 'unconfigured' = 'unconfigured'

          let withSecret: Awaited<ReturnType<typeof nodeService.getWithSecret>>
          try {
            withSecret = await nodeService.getWithSecret(node.id)
          } catch {
            return { id: node.id, name: node.name, api: 'error' as const, ssh: sshStatus }
          }

          try {
            await Promise.race([
              proxmoxService.testConnection({
                host: node.host, port: node.port,
                tokenId: node.tokenId, tokenSecret: withSecret.tokenSecret,
              }),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000)),
            ])
          } catch {
            apiStatus = 'error'
          }

          const hasSshCred = withSecret.sshAuthMethod === 'key'
            ? !!withSecret.sshPrivateKey
            : !!withSecret.sshPassword
          if (hasSshCred) {
            try {
              await Promise.race([
                testSshConnection({
                  host: withSecret.sshHost ?? node.host,
                  username: node.sshUser ?? 'root',
                  authMethod: withSecret.sshAuthMethod,
                  password: withSecret.sshPassword,
                  privateKey: withSecret.sshPrivateKey,
                  keyPassphrase: withSecret.sshKeyPassphrase,
                }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000)),
              ])
              sshStatus = 'ok'
            } catch {
              sshStatus = 'error'
            }
          }

          return { id: node.id, name: node.name, api: apiStatus, ssh: sshStatus }
        }),
      )

      return reply.send({
        ok: true,
        data: { db: dbStatus, redis: redisStatus, nodes: nodeResults },
      })
    },
  )

  // POST /api/diagnostics/test-ssh — test SSH connectivity for a specific node
  app.post(
    '/test-ssh',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const body = TestSshSchema.safeParse(request.body)
      if (!body.success) {
        throw AppError.validationError(
          'Invalid request body',
          body.error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
        )
      }

      const { node, sshPassword, sshHost, sshAuthMethod, sshPrivateKey, sshKeyPassphrase } = await nodeService.getWithSecret(body.data.nodeId)

      const hasCred = sshAuthMethod === 'key' ? !!sshPrivateKey : !!sshPassword
      if (!hasCred) {
        throw AppError.validationError('SSH credentials not configured for this node', [])
      }

      const host = sshHost ?? node.host
      const start = Date.now()
      try {
        await testSshConnection({
          host,
          username: node.sshUser ?? 'root',
          authMethod: sshAuthMethod,
          password: sshPassword,
          privateKey: sshPrivateKey,
          keyPassphrase: sshKeyPassphrase,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw AppError.validationError(`SSH connection failed: ${msg}`, [])
      }
      const latencyMs = Date.now() - start

      return reply.send({
        ok: true,
        data: { connected: true, host, latencyMs },
      })
    },
  )
  // GET /api/diagnostics/logs/:sessionId — fetch stored logs for a session
  app.get(
    '/logs/:sessionId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string }
      const entries = await getSessionLogs(sessionId)
      return reply.send({ ok: true, data: entries })
    },
  )

  // GET /api/diagnostics/logs/job/:jobType/:jobId — list sessions for a job
  app.get(
    '/logs/job/:jobType/:jobId',
    { preHandler: [app.authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { jobType, jobId } = request.params as { jobType: string; jobId: string }
      const sessions = await getJobSessions(jobType, jobId)
      return reply.send({ ok: true, data: sessions })
    },
  )
}

// ── SSH connectivity helper ────────────────────────────────────────────────

interface SshTestOptions {
  host: string
  username: string
  authMethod?: string | null
  password?: string | null
  privateKey?: string | null
  keyPassphrase?: string | null
}

async function testSshConnection(opts: SshTestOptions): Promise<void> {
  const connectCfg: Parameters<SshClient['connect']>[0] = {
    host: opts.host,
    port: 22,
    username: opts.username,
    hostVerifier: () => true,
  }

  if (opts.authMethod === 'key') {
    if (!opts.privateKey) throw new Error('SSH auth method is "key" but no private key provided')
    connectCfg.privateKey = await resolveSecret(opts.privateKey)
    if (opts.keyPassphrase) {
      connectCfg.passphrase = await resolveSecret(opts.keyPassphrase)
    }
  } else {
    if (!opts.password) throw new Error('SSH auth method is "password" but no password provided')
    connectCfg.password = opts.password
  }

  return new Promise((resolve, reject) => {
    const conn = new SshClient()
    conn.on('ready', () => {
      conn.exec('echo ninja-ops-ssh-ok', (err, stream) => {
        if (err) {
          conn.end()
          return reject(new Error(`SSH exec failed: ${err.message}`))
        }
        stream.on('close', () => {
          conn.end()
          resolve()
        })
        stream.resume()
        stream.stderr.resume()
      })
    })
    conn.on('error', (err) => {
      reject(new Error(`SSH connection failed: ${err.message}`))
    })
    conn.connect(connectCfg)
  })
}
