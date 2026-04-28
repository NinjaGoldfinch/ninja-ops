import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { TestApp } from '../helpers.js'
import { makeApp, makeToken, authHeader } from '../helpers.js'
import { AppError } from '../../errors.js'

vi.mock('../../services/service-redeploy.js', () => ({
  serviceRedeployService: {
    enqueue: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    cancel: vi.fn(),
  },
}))

vi.mock('../../services/service-versions.js', () => ({
  getServiceVersions: vi.fn().mockResolvedValue({
    'control-plane': {
      service: 'control-plane',
      current: '0.1.0',
      latest: '0.2.0',
      latestSha: 'abc123',
      updateAvailable: true,
      checkedAt: '2024-01-01T00:00:00.000Z',
    },
    'dashboard': {
      service: 'dashboard',
      current: '0.1.0',
      latest: '0.1.0',
      latestSha: 'def456',
      updateAvailable: false,
      checkedAt: '2024-01-01T00:00:00.000Z',
    },
  }),
  startVersionPoller: vi.fn(),
  stopVersionPoller: vi.fn(),
  refreshServiceVersions: vi.fn(),
}))

vi.mock('../../services/job-logger.js', () => ({
  getJobSessions: vi.fn().mockResolvedValue([]),
  getSessionLogs: vi.fn().mockResolvedValue([]),
  JobLogger: vi.fn(),
}))

import { serviceRedeployService } from '../../services/service-redeploy.js'

const mockJob = {
  id: crypto.randomUUID(),
  service: 'control-plane' as const,
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

describe('GET /api/services/versions', () => {
  it('returns 200 for operator', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/services/versions',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  })

  it('returns 200 for admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/services/versions',
      headers: authHeader(adminToken),
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/services/versions',
      headers: authHeader(viewerToken),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/services/:service/redeploy', () => {
  it('returns 201 with job for admin', async () => {
    vi.mocked(serviceRedeployService.enqueue).mockResolvedValue(mockJob)

    const res = await app.inject({
      method: 'POST',
      url: '/api/services/control-plane/redeploy',
      headers: authHeader(adminToken),
      payload: {},
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { ok: boolean; data: typeof mockJob }
    expect(body.ok).toBe(true)
    expect(body.data.service).toBe('control-plane')
  })

  it('returns 409 when service already has active job', async () => {
    vi.mocked(serviceRedeployService.enqueue).mockRejectedValue(
      AppError.conflict('A redeploy is already queued or running for control-plane'),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/services/control-plane/redeploy',
      headers: authHeader(adminToken),
      payload: {},
    })

    expect(res.statusCode).toBe(409)
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/services/control-plane/redeploy',
      headers: authHeader(viewerToken),
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    expect(serviceRedeployService.enqueue).not.toHaveBeenCalled()
  })

  it('returns 403 for operator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/services/control-plane/redeploy',
      headers: authHeader(operatorToken),
      payload: {},
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /api/services/redeploy-jobs', () => {
  it('returns 200 with job list for admin', async () => {
    vi.mocked(serviceRedeployService.listJobs).mockResolvedValue([mockJob])

    const res = await app.inject({
      method: 'GET',
      url: '/api/services/redeploy-jobs',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: unknown[] }
    expect(body.data).toHaveLength(1)
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/services/redeploy-jobs',
      headers: authHeader(viewerToken),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/services/redeploy-jobs/:jobId/cancel', () => {
  it('returns 200 for admin', async () => {
    vi.mocked(serviceRedeployService.cancel).mockResolvedValue({ ...mockJob, state: 'cancelled' })

    const res = await app.inject({
      method: 'POST',
      url: `/api/services/redeploy-jobs/${mockJob.id}/cancel`,
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(200)
    expect(serviceRedeployService.cancel).toHaveBeenCalledWith(mockJob.id)
  })

  it('returns 409 when job is not queued', async () => {
    vi.mocked(serviceRedeployService.cancel).mockRejectedValue(
      AppError.conflict('Only queued jobs can be cancelled'),
    )

    const res = await app.inject({
      method: 'POST',
      url: `/api/services/redeploy-jobs/${mockJob.id}/cancel`,
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(409)
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/services/redeploy-jobs/${mockJob.id}/cancel`,
      headers: authHeader(viewerToken),
    })
    expect(res.statusCode).toBe(403)
  })
})
