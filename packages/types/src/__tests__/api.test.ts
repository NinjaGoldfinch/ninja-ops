import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  API_ERROR_CODES,
  ApiErrorCodeSchema,
  ApiErrorSchema,
  ApiSuccessSchema,
  PaginationQuerySchema,
  PaginatedSchema,
  AUDIT_ACTIONS,
  AuditActionSchema,
  AuditLogEntrySchema,
} from '../api.js'

describe('API_ERROR_CODES', () => {
  it('contains expected error codes', () => {
    expect(API_ERROR_CODES).toContain('UNAUTHORIZED')
    expect(API_ERROR_CODES).toContain('NOT_FOUND')
    expect(API_ERROR_CODES).toContain('VALIDATION_ERROR')
    expect(API_ERROR_CODES).toContain('INTERNAL_ERROR')
    expect(API_ERROR_CODES).toContain('WEBHOOK_INVALID_SIGNATURE')
  })
})

describe('ApiErrorCodeSchema', () => {
  it('parses all valid error codes', () => {
    for (const code of API_ERROR_CODES) {
      expect(ApiErrorCodeSchema.safeParse(code).success).toBe(true)
    }
  })

  it('rejects unknown code', () => {
    expect(ApiErrorCodeSchema.safeParse('BAD_REQUEST').success).toBe(false)
  })
})

describe('ApiErrorSchema', () => {
  it('parses a valid error response', () => {
    const result = ApiErrorSchema.safeParse({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Resource not found',
    })
    expect(result.success).toBe(true)
  })

  it('parses a validation error with details', () => {
    const result = ApiErrorSchema.safeParse({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
      details: [
        { path: ['username'], message: 'String must contain at least 3 character(s)' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects ok: true', () => {
    const result = ApiErrorSchema.safeParse({
      ok: true,
      code: 'NOT_FOUND',
      message: 'test',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('ok')
    }
  })
})

describe('ApiSuccessSchema', () => {
  it('parses a valid success response', () => {
    const ResponseSchema = ApiSuccessSchema(z.object({ name: z.string() }))
    const result = ResponseSchema.safeParse({ ok: true, data: { name: 'samuel' } })
    expect(result.success).toBe(true)
  })

  it('rejects ok: false', () => {
    const ResponseSchema = ApiSuccessSchema(z.object({ name: z.string() }))
    const result = ResponseSchema.safeParse({ ok: false, data: { name: 'samuel' } })
    expect(result.success).toBe(false)
  })

  it('rejects invalid data shape', () => {
    const ResponseSchema = ApiSuccessSchema(z.object({ count: z.number() }))
    const result = ResponseSchema.safeParse({ ok: true, data: { count: 'not-a-number' } })
    expect(result.success).toBe(false)
  })
})

describe('PaginationQuerySchema', () => {
  it('applies defaults for page and limit', () => {
    const result = PaginationQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(1)
      expect(result.data.limit).toBe(20)
    }
  })

  it('coerces string numbers', () => {
    const result = PaginationQuerySchema.safeParse({ page: '2', limit: '50' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(2)
      expect(result.data.limit).toBe(50)
    }
  })

  it('rejects limit above 100', () => {
    const result = PaginationQuerySchema.safeParse({ limit: 101 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('limit')
    }
  })

  it('rejects page below 1', () => {
    const result = PaginationQuerySchema.safeParse({ page: 0 })
    expect(result.success).toBe(false)
  })
})

describe('PaginatedSchema', () => {
  it('parses a valid paginated response', () => {
    const Schema = PaginatedSchema(z.string())
    const result = Schema.safeParse({
      items: ['a', 'b', 'c'],
      total: 100,
      page: 1,
      limit: 20,
      hasMore: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative total', () => {
    const Schema = PaginatedSchema(z.string())
    const result = Schema.safeParse({
      items: [],
      total: -1,
      page: 1,
      limit: 20,
      hasMore: false,
    })
    expect(result.success).toBe(false)
  })
})

describe('AUDIT_ACTIONS', () => {
  it('contains expected audit actions', () => {
    expect(AUDIT_ACTIONS).toContain('login')
    expect(AUDIT_ACTIONS).toContain('deploy_trigger')
    expect(AUDIT_ACTIONS).toContain('guest_power')
    expect(AUDIT_ACTIONS).toContain('snapshot_create')
  })
})

describe('AuditLogEntrySchema', () => {
  it('parses a valid audit log entry', () => {
    const result = AuditLogEntrySchema.safeParse({
      id: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      username: 'samuel',
      action: 'login',
      createdAt: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('parses an entry with null userId (system action)', () => {
    const result = AuditLogEntrySchema.safeParse({
      id: crypto.randomUUID(),
      userId: null,
      username: null,
      action: 'deploy_trigger',
      createdAt: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid action', () => {
    const result = AuditLogEntrySchema.safeParse({
      id: crypto.randomUUID(),
      userId: null,
      username: null,
      action: 'hack',
      createdAt: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('action')
    }
  })
})
