import type { FastifyInstance } from 'fastify'
import { webhookService } from '../../services/webhook.js'
import { AppError } from '../../errors.js'

export default async function githubWebhookRoutes(app: FastifyInstance) {
  // POST /api/webhooks/github
  // Not JWT-authenticated — HMAC-verified instead
  app.post(
    '/github',
    {
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const signature = request.headers['x-hub-signature-256']
      if (typeof signature !== 'string') {
        throw AppError.webhookInvalidSignature()
      }

      const event = request.headers['x-github-event']
      if (event !== 'workflow_run') {
        // Unknown event — acknowledge but don't process
        return reply.send({ ok: true, data: { processed: false } })
      }

      // Raw body is available as a Buffer on request.rawBody
      // We configure addContentTypeParser below for this route's prefix
      const rawBody = (request as unknown as { rawBody: Buffer }).rawBody
      if (!rawBody) {
        throw AppError.internal('Raw body not available')
      }

      webhookService.verifyGithubSignature(rawBody, signature)
      const result = await webhookService.handleGithubWorkflowRun(rawBody)

      return reply.send({ ok: true, data: result })
    },
  )
}
