import type { FastifyInstance } from 'fastify'
import { LoginRequestSchema, ChangePasswordRequestSchema } from '@ninja/types'
import { authService } from '../../services/auth.js'
import { AppError } from '../../errors.js'

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const body = LoginRequestSchema.safeParse(request.body)
      if (!body.success) {
        throw AppError.validationError(
          'Invalid request body',
          body.error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
        )
      }
      const result = await authService.login(body.data.username, body.data.password)
      return reply.status(200).send({ ok: true, data: result })
    },
  )

  // PUT /api/auth/password
  app.put(
    '/password',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const body = ChangePasswordRequestSchema.safeParse(request.body)
      if (!body.success) {
        throw AppError.validationError(
          'Invalid request body',
          body.error.issues.map(i => ({ path: i.path.map(String), message: i.message })),
        )
      }
      await authService.changePassword(
        request.user.sub,
        body.data.currentPassword,
        body.data.newPassword,
      )
      return reply.status(200).send({ ok: true, data: null })
    },
  )
}
