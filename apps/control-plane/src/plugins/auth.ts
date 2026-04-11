import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { jwtVerify, SignJWT } from 'jose'
import { JwtPayloadSchema, type JwtPayload } from '@ninja/types'
import { config } from '../config.js'
import { AppError } from '../errors.js'

const secret = new TextEncoder().encode(config.JWT_SECRET)

export async function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.JWT_EXPIRY)
    .sign(secret)
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret)
  return JwtPayloadSchema.parse(payload)
}

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  // Fastify v5 reference types require a getter factory; authenticate prehandler sets the real value
  // Use null as placeholder; authenticate prehandler sets the real value before any route handler runs
  app.decorateRequest('user', null as unknown as JwtPayload)

  app.decorate(
    'authenticate',
    async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
      const authHeader = request.headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        throw AppError.unauthorized()
      }
      const token = authHeader.slice(7)
      try {
        request.user = await verifyToken(token)
      } catch {
        throw AppError.unauthorized('Invalid or expired token')
      }
    },
  )
})

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}
