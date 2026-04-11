import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeApp, makeToken, authHeader } from '../helpers.js'
import { AppError } from '../../errors.js'

vi.mock('../../services/node.js', () => ({
  nodeService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    syncStatus: vi.fn(),
  },
}))

vi.mock('../../services/audit.js', () => ({
  auditService: {
    log: vi.fn(),
    list: vi.fn(),
  },
}))

vi.mock('../../services/proxmox.js', () => ({
  proxmoxService: {
    testConnection: vi.fn(),
    listGuests: vi.fn(),
    powerAction: vi.fn(),
    listSnapshots: vi.fn(),
    createSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
    getMetrics: vi.fn(),
  },
}))

import { nodeService } from '../../services/node.js'

const listMock = vi.mocked(nodeService.list)
const getMock = vi.mocked(nodeService.get)
const createMock = vi.mocked(nodeService.create)
const deleteMock = vi.mocked(nodeService.delete)
const syncMock = vi.mocked(nodeService.syncStatus)

const mockNode = {
  id: 'node-uuid-1',
  name: 'pve-01',
  host: '10.0.0.1',
  port: 8006,
  tokenId: 'root@pam!mytoken',
  sshUser: 'root',
  sshAuthMethod: 'password' as const,
  status: 'online' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

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

describe('GET /api/nodes', () => {
  it('returns 200 with node list for viewer', async () => {
    listMock.mockResolvedValue([mockNode])

    const res = await app.inject({
      method: 'GET',
      url: '/api/nodes',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(1)
  })

  it('returns 401 when no auth token is provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nodes' })
    expect(res.statusCode).toBe(401)
    expect(listMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/nodes/:nodeId', () => {
  it('returns 200 with node for viewer', async () => {
    getMock.mockResolvedValue(mockNode)

    const res = await app.inject({
      method: 'GET',
      url: '/api/nodes/node-uuid-1',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: { id: string } }
    expect(body.data.id).toBe('node-uuid-1')
  })

  it('returns 404 when node does not exist', async () => {
    getMock.mockRejectedValue(AppError.notFound('Node'))

    const res = await app.inject({
      method: 'GET',
      url: '/api/nodes/nonexistent',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as { code: string }
    expect(body.code).toBe('NOT_FOUND')
  })
})

describe('POST /api/nodes', () => {
  const validBody = {
    name: 'pve-01',
    host: '10.0.0.1',
    port: 8006,
    tokenId: 'root@pam!mytoken',
    tokenSecret: 'super-secret',
  }

  it('returns 201 and creates node for admin', async () => {
    createMock.mockResolvedValue(mockNode)

    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: authHeader(adminToken),
      payload: validBody,
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { ok: boolean; data: { id: string } }
    expect(body.ok).toBe(true)
    expect(body.data.id).toBe('node-uuid-1')
    expect(createMock).toHaveBeenCalledWith(validBody)
  })

  it('returns 403 for operator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: authHeader(operatorToken),
      payload: validBody,
    })

    expect(res.statusCode).toBe(403)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: authHeader(viewerToken),
      payload: validBody,
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 401 with no token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: validBody,
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 422 for invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: authHeader(adminToken),
      payload: { name: 'pve' }, // missing required fields
    })

    expect(res.statusCode).toBe(422)
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/nodes/:nodeId', () => {
  it('returns 204 for admin', async () => {
    deleteMock.mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/nodes/node-uuid-1',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(204)
    expect(deleteMock).toHaveBeenCalledWith('node-uuid-1')
  })

  it('returns 403 for operator', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/nodes/node-uuid-1',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(403)
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/nodes/:nodeId/sync', () => {
  it('returns 200 with updated node for operator', async () => {
    syncMock.mockResolvedValue({ ...mockNode, status: 'offline' as const })

    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes/node-uuid-1/sync',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { data: { status: string } }
    expect(body.data.status).toBe('offline')
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes/node-uuid-1/sync',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(403)
    expect(syncMock).not.toHaveBeenCalled()
  })
})
