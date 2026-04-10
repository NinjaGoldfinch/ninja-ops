import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeApp, makeToken, authHeader } from '../helpers.js'
import { AppError } from '../../errors.js'

vi.mock('../../services/deploy.js', () => ({
  deployService: {
    listTargets: vi.fn(),
    getTarget: vi.fn(),
    createTarget: vi.fn(),
    updateTarget: vi.fn(),
    deleteTarget: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    triggerDeploy: vi.fn(),
    cancelJob: vi.fn(),
    getJobLogs: vi.fn(),
    findTargetByRepoBranch: vi.fn(),
  },
}))

vi.mock('../../services/audit.js', () => ({
  auditService: {
    log: vi.fn(),
    list: vi.fn(),
  },
}))

import { deployService } from '../../services/deploy.js'

const mockTarget = {
  id: 'target-uuid-1',
  repository: 'org/app',
  branch: 'main',
  nodeId: 'node-uuid-1',
  vmid: 100,
  workingDir: '/app',
  restartCommand: 'systemctl restart app',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

const mockJob = {
  id: 'job-uuid-1',
  targetId: 'target-uuid-1',
  state: 'queued' as const,
  trigger: { source: 'manual' as const },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

const validTargetBody = {
  repository: 'org/app',
  branch: 'main',
  nodeId: '00000000-0000-0000-0000-000000000001',
  vmid: 100,
  workingDir: '/app',
  restartCommand: 'systemctl restart app',
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

describe('GET /api/deploy/targets', () => {
  it('returns 200 with target list for viewer', async () => {
    vi.mocked(deployService.listTargets).mockResolvedValue([mockTarget])

    const res = await app.inject({
      method: 'GET',
      url: '/api/deploy/targets',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(1)
  })

  it('returns 401 with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deploy/targets' })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/deploy/targets/:targetId', () => {
  it('returns 200 with target for viewer', async () => {
    vi.mocked(deployService.getTarget).mockResolvedValue(mockTarget)

    const res = await app.inject({
      method: 'GET',
      url: '/api/deploy/targets/target-uuid-1',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { data: { id: string } }
    expect(body.data.id).toBe('target-uuid-1')
  })

  it('returns 404 when target does not exist', async () => {
    vi.mocked(deployService.getTarget).mockRejectedValue(AppError.notFound('Deploy target'))

    const res = await app.inject({
      method: 'GET',
      url: '/api/deploy/targets/nonexistent',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/deploy/targets', () => {
  it('returns 201 and creates target for admin', async () => {
    vi.mocked(deployService.createTarget).mockResolvedValue(mockTarget)

    const res = await app.inject({
      method: 'POST',
      url: '/api/deploy/targets',
      headers: authHeader(adminToken),
      payload: validTargetBody,
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { ok: boolean; data: { id: string } }
    expect(body.ok).toBe(true)
    expect(body.data.id).toBe('target-uuid-1')
  })

  it('returns 403 for operator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/deploy/targets',
      headers: authHeader(operatorToken),
      payload: validTargetBody,
    })

    expect(res.statusCode).toBe(403)
    expect(deployService.createTarget).not.toHaveBeenCalled()
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/deploy/targets',
      headers: authHeader(viewerToken),
      payload: validTargetBody,
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 422 for invalid body (missing required fields)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/deploy/targets',
      headers: authHeader(adminToken),
      payload: { repository: 'org/app' }, // missing most fields
    })

    expect(res.statusCode).toBe(422)
    expect(deployService.createTarget).not.toHaveBeenCalled()
  })

  it('returns 422 when nodeId is not a UUID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/deploy/targets',
      headers: authHeader(adminToken),
      payload: { ...validTargetBody, nodeId: 'not-a-uuid' },
    })

    expect(res.statusCode).toBe(422)
  })
})

describe('DELETE /api/deploy/targets/:targetId', () => {
  it('returns 204 for admin', async () => {
    vi.mocked(deployService.deleteTarget).mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/deploy/targets/target-uuid-1',
      headers: authHeader(adminToken),
    })

    expect(res.statusCode).toBe(204)
    expect(deployService.deleteTarget).toHaveBeenCalledWith('target-uuid-1')
  })

  it('returns 403 for operator', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/deploy/targets/target-uuid-1',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /api/deploy/jobs', () => {
  it('returns 200 with job list for viewer', async () => {
    vi.mocked(deployService.listJobs).mockResolvedValue([mockJob])

    const res = await app.inject({
      method: 'GET',
      url: '/api/deploy/jobs',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { data: unknown[] }
    expect(body.data).toHaveLength(1)
  })

  it('returns 401 with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deploy/jobs' })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/deploy/jobs (manual trigger)', () => {
  it('returns 201 and triggers deploy for operator', async () => {
    vi.mocked(deployService.triggerDeploy).mockResolvedValue(mockJob)

    const res = await app.inject({
      method: 'POST',
      url: '/api/deploy/jobs',
      headers: authHeader(operatorToken),
      payload: { targetId: '00000000-0000-0000-0000-000000000001' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { ok: boolean; data: { id: string } }
    expect(body.ok).toBe(true)
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/deploy/jobs',
      headers: authHeader(viewerToken),
      payload: { targetId: '00000000-0000-0000-0000-000000000001' },
    })

    expect(res.statusCode).toBe(403)
    expect(deployService.triggerDeploy).not.toHaveBeenCalled()
  })

  it('returns 422 when targetId is not a UUID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/deploy/jobs',
      headers: authHeader(operatorToken),
      payload: { targetId: 'not-a-uuid' },
    })

    expect(res.statusCode).toBe(422)
    expect(deployService.triggerDeploy).not.toHaveBeenCalled()
  })

  it('returns 409 when a deploy is already in progress', async () => {
    vi.mocked(deployService.triggerDeploy).mockRejectedValue(
      AppError.deployInProgress('target-uuid-1'),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/deploy/jobs',
      headers: authHeader(operatorToken),
      payload: { targetId: '00000000-0000-0000-0000-000000000001' },
    })

    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body) as { code: string }
    expect(body.code).toBe('DEPLOY_IN_PROGRESS')
  })
})

describe('DELETE /api/deploy/jobs/:jobId (cancel)', () => {
  it('returns 204 for operator', async () => {
    vi.mocked(deployService.cancelJob).mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/deploy/jobs/job-uuid-1',
      headers: authHeader(operatorToken),
    })

    expect(res.statusCode).toBe(204)
    expect(deployService.cancelJob).toHaveBeenCalledWith('job-uuid-1')
  })

  it('returns 403 for viewer', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/deploy/jobs/job-uuid-1',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(403)
    expect(deployService.cancelJob).not.toHaveBeenCalled()
  })
})

describe('GET /api/deploy/jobs/:jobId/logs', () => {
  it('returns 200 with log lines for viewer', async () => {
    vi.mocked(deployService.getJobLogs).mockResolvedValue([
      { id: 'line-1', jobId: 'job-uuid-1', seq: 1, stream: 'stdout' as const, line: 'Starting...', createdAt: '2024-01-01T00:00:00.000Z' },
    ])

    const res = await app.inject({
      method: 'GET',
      url: '/api/deploy/jobs/job-uuid-1/logs',
      headers: authHeader(viewerToken),
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { data: unknown[] }
    expect(body.data).toHaveLength(1)
  })
})
