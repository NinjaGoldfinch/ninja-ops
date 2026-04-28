import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { TestApp } from '../helpers.js'
import { makeApp, makeToken, authHeader } from '../helpers.js'
import { AppError } from '../../errors.js'

vi.mock('../../services/agent-redeploy.js', () => ({
  agentRedeployService: {
    enqueueOne: vi.fn(),
    enqueueAll: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    cancel: vi.fn(),
  },
}))

vi.mock('../../services/bundle-versions.js', () => ({
  getBundleVersions: vi.fn().mockReturnValue({
    deployAgentVersion: '0.2.0',
    logAgentVersion: '0.1.0',
  }),
}))

import { agentRedeployService } from '../../services/agent-redeploy.js'

const mockJob = {
  id: 'job-uuid-1',
  agentId: 'agent-uuid-1',
  state: 'queued' as const,
  errorMessage: null,
  queuedAt: '2024-01-01T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
}

let app: TestApp
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

describe('GET /api/agents/bundle-info', () => {
  it('returns 200 for operator', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/bundle-info',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: { deployAgentVersion: string; logAgentVersion: string } }
    expect(body.ok).toBe(true)
    expect(body.data.deployAgentVersion).toBe('0.2.0')
  })

  it('returns 200 for admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/bundle-info',
      headers: authHeader(adminToken),
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/bundle-info',
      headers: authHeader(viewerToken),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/agents/:agentId/redeploy', () => {
  it('returns 201 with job for admin', async () => {
    vi.mocked(agentRedeployService.enqueueOne).mockResolvedValue(mockJob)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-uuid-1/redeploy',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { ok: boolean; data: typeof mockJob }
    expect(body.ok).toBe(true)
    expect(body.data.id).toBe('job-uuid-1')
    expect(agentRedeployService.enqueueOne).toHaveBeenCalledWith('agent-uuid-1')
  })

  it('returns 409 when agent already has active job', async () => {
    vi.mocked(agentRedeployService.enqueueOne).mockRejectedValue(
      AppError.conflict('A redeploy is already queued or running for this agent'),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-uuid-1/redeploy',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(409)
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-uuid-1/redeploy',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(403)
    expect(agentRedeployService.enqueueOne).not.toHaveBeenCalled()
  })

  it('returns 403 for operator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-uuid-1/redeploy',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/agents/redeploy-all', () => {
  it('returns 201 with job list for admin', async () => {
    vi.mocked(agentRedeployService.enqueueAll).mockResolvedValue([mockJob])

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/redeploy-all',
      headers: authHeader(adminToken),
      payload: { onlyOutdated: true },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { ok: boolean; data: typeof mockJob[] }
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(agentRedeployService.enqueueAll).toHaveBeenCalledWith({ onlyOutdated: true })
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/redeploy-all',
      headers: authHeader(viewerToken),
      payload: {},
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /api/agents/redeploy-jobs', () => {
  it('returns 200 with job list for admin', async () => {
    vi.mocked(agentRedeployService.listJobs).mockResolvedValue([mockJob])

    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/redeploy-jobs',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: unknown[] }
    expect(body.data).toHaveLength(1)
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/redeploy-jobs',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/agents/redeploy-jobs/:jobId/cancel', () => {
  it('returns 200 for admin', async () => {
    vi.mocked(agentRedeployService.cancel).mockResolvedValue({ ...mockJob, state: 'cancelled' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/redeploy-jobs/job-uuid-1/cancel',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(200)
    expect(agentRedeployService.cancel).toHaveBeenCalledWith('job-uuid-1')
  })

  it('returns 409 when job is not queued', async () => {
    vi.mocked(agentRedeployService.cancel).mockRejectedValue(
      AppError.conflict('Only queued jobs can be cancelled'),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/redeploy-jobs/job-uuid-1/cancel',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(409)
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/redeploy-jobs/job-uuid-1/cancel',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(403)
  })
})
