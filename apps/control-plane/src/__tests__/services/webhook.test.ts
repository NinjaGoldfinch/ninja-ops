import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WebhookService } from '../../services/webhook.js'

vi.mock('../../services/deploy.js', () => ({
  deployService: {
    findTargetByRepoBranch: vi.fn(),
    triggerDeploy: vi.fn(),
  },
}))

const WEBHOOK_SECRET = 'test_webhook_secret'

function makeSignature(body: string | Buffer): string {
  const buf = typeof body === 'string' ? Buffer.from(body) : body
  return `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(buf).digest('hex')}`
}

function makePayload(overrides: Record<string, unknown> = {}): Buffer {
  const base = {
    action: 'completed',
    workflow_run: {
      id: 42,
      name: 'CI',
      head_branch: 'main',
      head_sha: 'abc123def456',
      conclusion: 'success',
      html_url: 'https://github.com/org/repo/actions/runs/42',
      repository: { full_name: 'org/repo' },
      triggering_actor: { login: 'developer' },
    },
    ...overrides,
  }
  return Buffer.from(JSON.stringify(base))
}

describe('WebhookService.verifyGithubSignature', () => {
  const service = new WebhookService()

  it('passes for a valid HMAC-SHA256 signature', () => {
    const body = Buffer.from('{"action":"completed"}')
    expect(() => service.verifyGithubSignature(body, makeSignature(body))).not.toThrow()
  })

  it('throws for an incorrect signature value', () => {
    const body = Buffer.from('{"action":"completed"}')
    expect(() =>
      service.verifyGithubSignature(body, 'sha256=0000000000000000000000000000000000000000000000000000000000000000'),
    ).toThrow()
  })

  it('throws when the body has been tampered with', () => {
    const original = Buffer.from('{"action":"completed"}')
    const sig = makeSignature(original)
    const tampered = Buffer.from('{"action":"in_progress"}')
    expect(() => service.verifyGithubSignature(tampered, sig)).toThrow()
  })

  it('throws when the signature length differs (timing-safe path)', () => {
    const body = Buffer.from('test')
    expect(() => service.verifyGithubSignature(body, 'sha256=short')).toThrow()
  })
})

describe('WebhookService.handleGithubWorkflowRun', () => {
  let service: WebhookService
  let findTarget: ReturnType<typeof vi.fn>
  let triggerDeploy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const mod = await import('../../services/deploy.js')
    const ds = mod.deployService as { findTargetByRepoBranch: ReturnType<typeof vi.fn>; triggerDeploy: ReturnType<typeof vi.fn> }
    findTarget = ds.findTargetByRepoBranch
    triggerDeploy = ds.triggerDeploy
    vi.clearAllMocks()
    service = new WebhookService()
  })

  it('returns {triggered: false} for action !== completed', async () => {
    const body = makePayload({ action: 'requested' })
    const result = await service.handleGithubWorkflowRun(body)
    expect(result.triggered).toBe(false)
    expect(findTarget).not.toHaveBeenCalled()
  })

  it('returns {triggered: false} for conclusion !== success', async () => {
    const body = makePayload({
      workflow_run: {
        id: 1, name: 'CI', head_branch: 'main', head_sha: 'abc', conclusion: 'failure',
        html_url: 'https://github.com/org/repo/actions/runs/1',
        repository: { full_name: 'org/repo' },
        triggering_actor: { login: 'dev' },
      },
    })
    const result = await service.handleGithubWorkflowRun(body)
    expect(result.triggered).toBe(false)
  })

  it('returns {triggered: false} when no matching deploy target exists', async () => {
    findTarget.mockResolvedValue(null)
    const result = await service.handleGithubWorkflowRun(makePayload())
    expect(result.triggered).toBe(false)
    expect(findTarget).toHaveBeenCalledWith('org/repo', 'main')
  })

  it('triggers a deploy and returns {triggered: true} when a target matches', async () => {
    findTarget.mockResolvedValue({ id: 'target-uuid-1' })
    triggerDeploy.mockResolvedValue({ id: 'job-uuid-1' })

    const result = await service.handleGithubWorkflowRun(makePayload())

    expect(result.triggered).toBe(true)
    expect(triggerDeploy).toHaveBeenCalledWith(
      'target-uuid-1',
      expect.objectContaining({
        source: 'github_webhook',
        repository: 'org/repo',
        branch: 'main',
        commitSha: 'abc123def456',
        actor: 'developer',
        workflowRunId: 42,
      }),
    )
  })

  it('returns {triggered: false} for an invalid / unrecognised payload shape', async () => {
    const body = Buffer.from(JSON.stringify({ totally: 'wrong', structure: true }))
    const result = await service.handleGithubWorkflowRun(body)
    expect(result.triggered).toBe(false)
  })
})
