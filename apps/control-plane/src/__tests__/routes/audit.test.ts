import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeApp, makeToken, authHeader } from '../helpers.js'

vi.mock('../../services/audit.js', () => ({
  auditService: {
    log: vi.fn(),
    list: vi.fn(),
  },
}))

import { auditService } from '../../services/audit.js'

const mockAuditItems = [
  {
    id: 'audit-1',
    userId: 'user-1',
    username: 'admin',
    action: 'node_create',
    resourceType: 'node',
    resourceId: 'node-1',
    meta: {},
    ip: '127.0.0.1',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
]

let app: FastifyInstance
let adminToken: string
let operatorToken: string
let viewerToken: string

beforeAll(async () => {
  app = await makeApp()
  ;[adminToken, operatorToken, viewerToken] = await Promise.all([
    makeToken('admin'),
    makeToken('operator'),
    makeToken('viewer'),
  ])
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/audit', () => {
  it('returns 200 with paginated audit log for admin', async () => {
    vi.mocked(auditService.list).mockResolvedValue({
      items: mockAuditItems,
      total: 1,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as {
      ok: boolean
      data: { items: unknown[]; total: number; page: number; limit: number; hasMore: boolean }
    }
    expect(body.ok).toBe(true)
    expect(body.data.items).toHaveLength(1)
    expect(body.data.total).toBe(1)
    expect(body.data.page).toBe(1)
    expect(body.data.hasMore).toBe(false)
  })

  it('passes pagination parameters to the service', async () => {
    vi.mocked(auditService.list).mockResolvedValue({ items: [], total: 50 })

    const res = await app.inject({
      method: 'GET',
      url: '/api/audit?page=2&limit=10',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(200)
    expect(auditService.list).toHaveBeenCalledWith({ page: 2, limit: 10 })

    const body = JSON.parse(res.body) as { data: { page: number; limit: number; hasMore: boolean } }
    expect(body.data.page).toBe(2)
    expect(body.data.limit).toBe(10)
    expect(body.data.hasMore).toBe(true) // 2 * 10 = 20 < 50
  })

  it('returns 403 for operator', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(403)
    expect(auditService.list).not.toHaveBeenCalled()
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(403)
    expect(auditService.list).not.toHaveBeenCalled()
  })

  it('returns 401 with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audit' })
    expect(res.statusCode).toBe(401)
    expect(auditService.list).not.toHaveBeenCalled()
  })
})
