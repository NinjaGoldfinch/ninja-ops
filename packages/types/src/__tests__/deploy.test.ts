import { describe, it, expect } from 'vitest'
import {
  DeployJobSchema,
  DeployTriggerSchema,
  DeployStateSchema,
  DeployTargetSchema,
  DeployLogLineSchema,
  GithubWorkflowRunPayloadSchema,
  DEPLOY_STATES,
  DEPLOY_TERMINAL_STATES,
} from '../deploy.js'

describe('DeployTriggerSchema', () => {
  it('parses a github_webhook trigger', () => {
    const result = DeployTriggerSchema.safeParse({
      source: 'github_webhook',
      repository: 'NinjaGoldfinch/ninja-skyblock-api',
      branch: 'main',
      commitSha: 'a'.repeat(40),
    })
    expect(result.success).toBe(true)
  })

  it('rejects a github_webhook trigger with short commitSha', () => {
    const result = DeployTriggerSchema.safeParse({
      source: 'github_webhook',
      repository: 'NinjaGoldfinch/ninja-skyblock-api',
      branch: 'main',
      commitSha: 'abc',
    })
    expect(result.success).toBe(false)
  })

  it('parses a manual trigger', () => {
    const result = DeployTriggerSchema.safeParse({
      source: 'manual',
      userId: crypto.randomUUID(),
      username: 'samuel',
    })
    expect(result.success).toBe(true)
  })

  it('parses a cli trigger', () => {
    const result = DeployTriggerSchema.safeParse({
      source: 'cli',
      userId: crypto.randomUUID(),
      username: 'samuel',
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown source', () => {
    const result = DeployTriggerSchema.safeParse({ source: 'cron' })
    expect(result.success).toBe(false)
  })

  it('rejects manual trigger missing userId', () => {
    const result = DeployTriggerSchema.safeParse({
      source: 'manual',
      username: 'samuel',
    })
    expect(result.success).toBe(false)
  })
})

describe('DEPLOY_STATES', () => {
  it('includes all expected states', () => {
    expect(DEPLOY_STATES).toContain('queued')
    expect(DEPLOY_STATES).toContain('dispatched')
    expect(DEPLOY_STATES).toContain('running')
    expect(DEPLOY_STATES).toContain('success')
    expect(DEPLOY_STATES).toContain('failed')
    expect(DEPLOY_STATES).toContain('cancelled')
  })

  it('terminal states are a subset of all states', () => {
    DEPLOY_TERMINAL_STATES.forEach(s => {
      expect(DEPLOY_STATES).toContain(s)
    })
  })
})

describe('DeployStateSchema', () => {
  it('parses all valid states', () => {
    for (const state of DEPLOY_STATES) {
      expect(DeployStateSchema.safeParse(state).success).toBe(true)
    }
  })

  it('rejects invalid state', () => {
    expect(DeployStateSchema.safeParse('pending').success).toBe(false)
  })
})

describe('DeployTargetSchema', () => {
  const validTarget = {
    id: crypto.randomUUID(),
    repository: 'NinjaGoldfinch/api',
    branch: 'main',
    nodeId: crypto.randomUUID(),
    vmid: 100,
    workingDir: '/opt/app',
    restartCommand: 'systemctl restart app',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('parses a valid deploy target', () => {
    expect(DeployTargetSchema.safeParse(validTarget).success).toBe(true)
  })

  it('applies default timeoutSeconds of 300', () => {
    const result = DeployTargetSchema.safeParse(validTarget)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.timeoutSeconds).toBe(300)
    }
  })

  it('rejects non-positive vmid', () => {
    const result = DeployTargetSchema.safeParse({ ...validTarget, vmid: -1 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('vmid')
    }
  })
})

describe('DeployJobSchema', () => {
  const validJob = {
    id: crypto.randomUUID(),
    targetId: crypto.randomUUID(),
    trigger: {
      source: 'manual',
      userId: crypto.randomUUID(),
      username: 'samuel',
    },
    state: 'queued',
    agentId: null,
    queuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    errorMessage: null,
  }

  it('parses a valid deploy job', () => {
    expect(DeployJobSchema.safeParse(validJob).success).toBe(true)
  })

  it('rejects invalid state', () => {
    const result = DeployJobSchema.safeParse({ ...validJob, state: 'unknown' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('state')
    }
  })
})

describe('DeployLogLineSchema', () => {
  it('parses a valid log line', () => {
    const result = DeployLogLineSchema.safeParse({
      jobId: crypto.randomUUID(),
      seq: 0,
      timestamp: new Date().toISOString(),
      stream: 'stdout',
      line: 'Build complete.',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid stream value', () => {
    const result = DeployLogLineSchema.safeParse({
      jobId: crypto.randomUUID(),
      seq: 0,
      timestamp: new Date().toISOString(),
      stream: 'stdin',
      line: 'test',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('stream')
    }
  })

  it('rejects negative seq', () => {
    const result = DeployLogLineSchema.safeParse({
      jobId: crypto.randomUUID(),
      seq: -1,
      timestamp: new Date().toISOString(),
      stream: 'stdout',
      line: 'test',
    })
    expect(result.success).toBe(false)
  })
})

describe('GithubWorkflowRunPayloadSchema', () => {
  it('parses a completed workflow run payload', () => {
    const result = GithubWorkflowRunPayloadSchema.safeParse({
      action: 'completed',
      workflow_run: {
        id: 123456,
        name: 'CI',
        head_branch: 'main',
        head_sha: 'a'.repeat(40),
        conclusion: 'success',
        html_url: 'https://github.com/owner/repo/actions/runs/123456',
        repository: { full_name: 'owner/repo' },
        triggering_actor: { login: 'samuel' },
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid action', () => {
    const result = GithubWorkflowRunPayloadSchema.safeParse({ action: 'deleted' })
    expect(result.success).toBe(false)
  })
})
