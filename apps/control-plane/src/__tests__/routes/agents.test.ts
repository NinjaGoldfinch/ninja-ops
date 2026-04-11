import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeApp, makeToken, authHeader } from '../helpers.js'
import { AppError } from '../../errors.js'

vi.mock('../../services/agent.js', () => ({
  agentService: {
    register: vi.fn(),
    markConnected: vi.fn(),
    markDisconnected: vi.fn(),
    isConnected: vi.fn(),
    getSocket: vi.fn(),
    sendCommand: vi.fn(),
    handleHeartbeat: vi.fn(),
    getAgentForVmid: vi.fn(),
    listAgents: vi.fn(),
    deleteAgent: vi.fn(),
  },
}))

import { agentService } from '../../services/agent.js'

const mockAgent = {
  id: 'agent-uuid-1',
  nodeId: 'node-uuid-1',
  vmid: 100,
  hostname: 'container-01',
  version: '1.0.0',
  kind: 'deploy' as const,
  status: 'idle' as const,
  lastSeenAt: '2024-01-01T00:00:00.000Z',
  registeredAt: '2024-01-01T00:00:00.000Z',
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

describe('GET /api/agents', () => {
  it('returns 200 with agent list for admin', async () => {
    vi.mocked(agentService.listAgents).mockResolvedValue([mockAgent])

    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(1)
  })

  it('returns 403 for operator', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(403)
    expect(agentService.listAgents).not.toHaveBeenCalled()
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(403)
    expect(agentService.listAgents).not.toHaveBeenCalled()
  })

  it('returns 401 with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents' })
    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /api/agents/:agentId', () => {
  it('returns 204 for admin', async () => {
    vi.mocked(agentService.deleteAgent).mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agents/agent-uuid-1',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(204)
    expect(agentService.deleteAgent).toHaveBeenCalledWith('agent-uuid-1')
  })

  it('returns 403 for operator', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agents/agent-uuid-1',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(403)
    expect(agentService.deleteAgent).not.toHaveBeenCalled()
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agents/agent-uuid-1',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 404 when agent does not exist', async () => {
    vi.mocked(agentService.deleteAgent).mockRejectedValue(AppError.notFound('Agent'))

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agents/nonexistent',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(404)
  })
})
