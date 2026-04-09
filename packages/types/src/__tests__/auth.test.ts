import { describe, it, expect } from 'vitest'
import {
  ROLES,
  RoleSchema,
  UserSchema,
  JwtPayloadSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  ChangePasswordRequestSchema,
} from '../auth.js'

describe('ROLES', () => {
  it('contains all expected roles', () => {
    expect(ROLES).toContain('admin')
    expect(ROLES).toContain('operator')
    expect(ROLES).toContain('viewer')
  })
})

describe('RoleSchema', () => {
  it('parses valid roles', () => {
    expect(RoleSchema.parse('admin')).toBe('admin')
    expect(RoleSchema.parse('operator')).toBe('operator')
    expect(RoleSchema.parse('viewer')).toBe('viewer')
  })

  it('rejects invalid role', () => {
    const result = RoleSchema.safeParse('superuser')
    expect(result.success).toBe(false)
  })
})

describe('UserSchema', () => {
  const validUser = {
    id: crypto.randomUUID(),
    username: 'samuel',
    role: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('parses a valid user', () => {
    expect(UserSchema.safeParse(validUser).success).toBe(true)
  })

  it('rejects username shorter than 3 chars', () => {
    const result = UserSchema.safeParse({ ...validUser, username: 'ab' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('username')
    }
  })

  it('rejects invalid uuid for id', () => {
    const result = UserSchema.safeParse({ ...validUser, id: 'not-a-uuid' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('id')
    }
  })

  it('rejects invalid datetime for createdAt', () => {
    const result = UserSchema.safeParse({ ...validUser, createdAt: '2024-01-01' })
    expect(result.success).toBe(false)
  })
})

describe('JwtPayloadSchema', () => {
  const validPayload = {
    sub: crypto.randomUUID(),
    username: 'samuel',
    role: 'operator',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }

  it('parses a valid JWT payload', () => {
    expect(JwtPayloadSchema.safeParse(validPayload).success).toBe(true)
  })

  it('rejects missing exp', () => {
    const { exp: _exp, ...noExp } = validPayload
    const result = JwtPayloadSchema.safeParse(noExp)
    expect(result.success).toBe(false)
  })
})

describe('LoginRequestSchema', () => {
  it('parses valid login request', () => {
    expect(LoginRequestSchema.safeParse({ username: 'samuel', password: 'secret' }).success).toBe(true)
  })

  it('rejects empty password', () => {
    const result = LoginRequestSchema.safeParse({ username: 'samuel', password: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('password')
    }
  })
})

describe('LoginResponseSchema', () => {
  it('parses valid login response', () => {
    const result = LoginResponseSchema.safeParse({
      token: 'eyJhbGciOiJIUzI1NiJ9.test.sig',
      user: {
        id: crypto.randomUUID(),
        username: 'samuel',
        role: 'admin',
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('ChangePasswordRequestSchema', () => {
  it('parses a valid change password request', () => {
    const result = ChangePasswordRequestSchema.safeParse({
      currentPassword: 'oldpass',
      newPassword: 'newlongpassword123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects new password shorter than 12 chars', () => {
    const result = ChangePasswordRequestSchema.safeParse({
      currentPassword: 'oldpass',
      newPassword: 'short',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('newPassword')
    }
  })
})
