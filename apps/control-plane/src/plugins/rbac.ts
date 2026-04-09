import type { FastifyRequest, FastifyReply } from 'fastify'
import { type Role, ROLES } from '@ninja/types'
import { AppError } from '../errors.js'

const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
}

export function requireRole(minimum: Role) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const userRole = request.user.role
    const userRank = ROLE_RANK[userRole] ?? -1
    const requiredRank = ROLE_RANK[minimum] ?? 999
    if (userRank < requiredRank) {
      throw AppError.forbidden(`Requires ${minimum} role or higher`)
    }
  }
}

// Re-export ROLES for use in route files that need to iterate
export { ROLES }
