import bcrypt from 'bcrypt'
import { sql } from '../db/client.js'
import { signToken } from '../plugins/auth.js'
import { AppError } from '../errors.js'
import type { User, LoginResponse } from '@ninja/types'

const BCRYPT_ROUNDS = 12

interface DbUser {
  id: string
  username: string
  password: string
  role: string
  created_at: Date
  updated_at: Date
}

function toUser(row: DbUser): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role as User['role'],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export class AuthService {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS)
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const rows = await sql<DbUser[]>`
      SELECT id, username, password, role, created_at, updated_at
      FROM users
      WHERE username = ${username}
    `
    const row = rows[0]
    if (!row) {
      throw AppError.unauthorized('Invalid username or password')
    }

    const valid = await this.verifyPassword(password, row.password)
    if (!valid) {
      throw AppError.unauthorized('Invalid username or password')
    }

    const user = toUser(row)
    const token = await signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
    })

    return { token, user: { id: user.id, username: user.username, role: user.role } }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const rows = await sql<DbUser[]>`
      SELECT id, username, password, role, created_at, updated_at
      FROM users
      WHERE id = ${userId}
    `
    const row = rows[0]
    if (!row) {
      throw AppError.notFound('User')
    }

    const valid = await this.verifyPassword(currentPassword, row.password)
    if (!valid) {
      throw AppError.unauthorized('Current password is incorrect')
    }

    const hash = await this.hashPassword(newPassword)
    await sql`
      UPDATE users SET password = ${hash}, updated_at = now()
      WHERE id = ${userId}
    `
  }
}

export const authService = new AuthService()
