import { describe, it, expect } from 'vitest'
import {
  ServiceNameSchema,
  ServiceRedeployStateSchema,
  ServiceVersionSchema,
  ServiceRedeployJobSchema,
  EnqueueServiceRedeploySchema,
} from '../service-redeploy.js'

describe('ServiceNameSchema', () => {
  it('parses valid service names', () => {
    expect(ServiceNameSchema.parse('control-plane')).toBe('control-plane')
    expect(ServiceNameSchema.parse('dashboard')).toBe('dashboard')
  })

  it('rejects unknown service name', () => {
    expect(ServiceNameSchema.safeParse('forge').success).toBe(false)
  })
})

describe('ServiceRedeployStateSchema', () => {
  it('parses all valid states', () => {
    for (const s of ['queued', 'running', 'success', 'failed', 'cancelled']) {
      expect(ServiceRedeployStateSchema.parse(s)).toBe(s)
    }
  })

  it('rejects invalid state', () => {
    expect(ServiceRedeployStateSchema.safeParse('pending').success).toBe(false)
  })
})

describe('ServiceVersionSchema', () => {
  const valid = {
    service: 'control-plane' as const,
    current: '1.4.2',
    latest: '1.5.0',
    latestSha: 'abc123def456',
    updateAvailable: true,
    checkedAt: new Date().toISOString(),
  }

  it('parses a valid service version', () => {
    expect(ServiceVersionSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects missing checkedAt', () => {
    const { checkedAt: _, ...rest } = valid
    expect(ServiceVersionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects invalid service name', () => {
    expect(ServiceVersionSchema.safeParse({ ...valid, service: 'unknown' }).success).toBe(false)
  })
})

describe('ServiceRedeployJobSchema', () => {
  const valid = {
    id: crypto.randomUUID(),
    service: 'dashboard' as const,
    state: 'queued' as const,
    errorMessage: null,
    queuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  }

  it('parses a valid queued job', () => {
    expect(ServiceRedeployJobSchema.safeParse(valid).success).toBe(true)
  })

  it('parses a job with optional targetVersion', () => {
    expect(ServiceRedeployJobSchema.safeParse({ ...valid, targetVersion: 'v1.5.0' }).success).toBe(true)
  })

  it('rejects non-uuid id', () => {
    const result = ServiceRedeployJobSchema.safeParse({ ...valid, id: 'not-a-uuid' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toContain('id')
  })

  it('rejects invalid state', () => {
    expect(ServiceRedeployJobSchema.safeParse({ ...valid, state: 'done' }).success).toBe(false)
  })
})

describe('EnqueueServiceRedeploySchema', () => {
  it('parses with just service', () => {
    expect(EnqueueServiceRedeploySchema.safeParse({ service: 'control-plane' }).success).toBe(true)
  })

  it('parses with optional targetVersion', () => {
    expect(EnqueueServiceRedeploySchema.safeParse({ service: 'dashboard', targetVersion: 'v1.5.0' }).success).toBe(true)
  })

  it('rejects unknown service', () => {
    expect(EnqueueServiceRedeploySchema.safeParse({ service: 'forge' }).success).toBe(false)
  })
})
