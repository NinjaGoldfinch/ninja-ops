import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeApp } from '../helpers.js'
import { AppError } from '../../errors.js'

vi.mock('../../services/webhook.js', () => ({
  webhookService: {
    verifyGithubSignature: vi.fn(),
    handleGithubWorkflowRun: vi.fn(),
  },
}))

import { webhookService } from '../../services/webhook.js'

const verifyMock = vi.mocked(webhookService.verifyGithubSignature)
const handleMock = vi.mocked(webhookService.handleGithubWorkflowRun)

const VALID_PAYLOAD = JSON.stringify({
  action: 'completed',
  workflow_run: {
    id: 1,
    name: 'CI',
    head_branch: 'main',
    head_sha: 'abc123',
    conclusion: 'success',
    html_url: 'https://github.com/org/repo/actions/runs/1',
    repository: { full_name: 'org/repo' },
    triggering_actor: { login: 'dev' },
  },
})

let app: FastifyInstance

beforeAll(async () => {
  app = await makeApp()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/webhooks/github', () => {
  it('returns 200 with triggered: true for a valid workflow_run event', async () => {
    verifyMock.mockReturnValue(undefined)
    handleMock.mockResolvedValue({ triggered: true })

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      payload: VALID_PAYLOAD,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=somesignature',
        'x-github-event': 'workflow_run',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: { triggered: boolean } }
    expect(body.ok).toBe(true)
    expect(body.data.triggered).toBe(true)
    expect(verifyMock).toHaveBeenCalled()
    expect(handleMock).toHaveBeenCalled()
  })

  it('returns 200 with triggered: false when no matching target', async () => {
    verifyMock.mockReturnValue(undefined)
    handleMock.mockResolvedValue({ triggered: false })

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      payload: VALID_PAYLOAD,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=somesignature',
        'x-github-event': 'workflow_run',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { data: { triggered: boolean } }
    expect(body.data.triggered).toBe(false)
  })

  it('returns 401 when signature verification fails', async () => {
    verifyMock.mockImplementation(() => {
      throw AppError.webhookInvalidSignature()
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      payload: VALID_PAYLOAD,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=invalidsignature',
        'x-github-event': 'workflow_run',
      },
    })

    expect(res.statusCode).toBe(401)
    const body = JSON.parse(res.body) as { code: string }
    expect(body.code).toBe('WEBHOOK_INVALID_SIGNATURE')
    expect(handleMock).not.toHaveBeenCalled()
  })

  it('returns 401 when x-hub-signature-256 header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      payload: VALID_PAYLOAD,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'workflow_run',
        // no x-hub-signature-256
      },
    })

    expect(res.statusCode).toBe(401)
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('returns 200 with processed: false for non-workflow_run events', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/github',
      payload: '{"action":"ping"}',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=somesignature',
        'x-github-event': 'push', // not workflow_run
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { data: { processed: boolean } }
    expect(body.data.processed).toBe(false)
    expect(verifyMock).not.toHaveBeenCalled()
    expect(handleMock).not.toHaveBeenCalled()
  })
})
