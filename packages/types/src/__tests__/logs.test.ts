import { describe, it, expect } from 'vitest'
import {
  LOG_LEVELS,
  LogLevelSchema,
  LogSourceSchema,
  LogEntrySchema,
  LokiLabelsSchema,
  LogQuerySchema,
  LogSubscriptionSchema,
  LogQueryParamsSchema,
  LogStatsParamsSchema,
  SavedLogFilterSchema,
} from '../logs.js'

describe('LOG_LEVELS', () => {
  it('contains all expected levels', () => {
    expect(LOG_LEVELS).toContain('trace')
    expect(LOG_LEVELS).toContain('debug')
    expect(LOG_LEVELS).toContain('info')
    expect(LOG_LEVELS).toContain('warn')
    expect(LOG_LEVELS).toContain('error')
    expect(LOG_LEVELS).toContain('fatal')
  })
})

describe('LogLevelSchema', () => {
  it('parses all valid log levels', () => {
    for (const level of LOG_LEVELS) {
      expect(LogLevelSchema.safeParse(level).success).toBe(true)
    }
  })

  it('rejects invalid level', () => {
    expect(LogLevelSchema.safeParse('verbose').success).toBe(false)
  })
})

describe('LogSourceSchema', () => {
  it('parses a guest source', () => {
    const result = LogSourceSchema.safeParse({
      kind: 'guest',
      nodeId: crypto.randomUUID(),
      vmid: 100,
    })
    expect(result.success).toBe(true)
  })

  it('parses a host source', () => {
    const result = LogSourceSchema.safeParse({
      kind: 'host',
      nodeId: crypto.randomUUID(),
    })
    expect(result.success).toBe(true)
  })

  it('parses a control-plane source', () => {
    const result = LogSourceSchema.safeParse({
      kind: 'control-plane',
      service: 'api',
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown kind', () => {
    const result = LogSourceSchema.safeParse({ kind: 'external' })
    expect(result.success).toBe(false)
  })

  it('rejects guest source missing nodeId', () => {
    const result = LogSourceSchema.safeParse({ kind: 'guest', vmid: 100 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('nodeId')
    }
  })
})

describe('LogEntrySchema', () => {
  const validEntry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'Server started on port 3000',
    source: { kind: 'control-plane' as const },
  }

  it('parses a valid log entry', () => {
    expect(LogEntrySchema.safeParse(validEntry).success).toBe(true)
  })

  it('parses an entry without level (optional)', () => {
    const { level: _level, ...noLevel } = validEntry
    expect(LogEntrySchema.safeParse(noLevel).success).toBe(true)
  })

  it('rejects invalid timestamp', () => {
    const result = LogEntrySchema.safeParse({ ...validEntry, timestamp: 'not-a-date' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('timestamp')
    }
  })
})

describe('LokiLabelsSchema', () => {
  it('parses valid Loki labels', () => {
    const result = LokiLabelsSchema.safeParse({
      source: 'guest',
      node_id: crypto.randomUUID(),
      vmid: '100',
      service: 'skyblock-api',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid source', () => {
    const result = LokiLabelsSchema.safeParse({ source: 'agent' })
    expect(result.success).toBe(false)
  })
})

describe('LogQuerySchema', () => {
  it('applies defaults for limit and direction', () => {
    const result = LogQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(200)
      expect(result.data.direction).toBe('backward')
    }
  })

  it('rejects limit above 5000', () => {
    const result = LogQuerySchema.safeParse({ limit: 5001 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('limit')
    }
  })

  it('rejects invalid direction', () => {
    const result = LogQuerySchema.safeParse({ direction: 'sideways' })
    expect(result.success).toBe(false)
  })
})

describe('LogSubscriptionSchema', () => {
  it('parses a valid subscription', () => {
    const result = LogSubscriptionSchema.safeParse({
      source: { kind: 'control-plane' },
      levels: ['error', 'fatal'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid log level in levels array', () => {
    const result = LogSubscriptionSchema.safeParse({
      source: { kind: 'control-plane' },
      levels: ['critical'],
    })
    expect(result.success).toBe(false)
  })
})

describe('LogQueryParamsSchema', () => {
  it('applies defaults for limit and searchMode', () => {
    const result = LogQueryParamsSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(100)
      expect(result.data.searchMode).toBe('text')
    }
  })

  it('parses multi-value filters', () => {
    const result = LogQueryParamsSchema.safeParse({
      levels: ['info', 'warn', 'error'],
      sources: ['app', 'agent'],
      vmids: ['101', '102'],
      units: ['nginx', 'api'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.levels).toEqual(['info', 'warn', 'error'])
      expect(result.data.sources).toEqual(['app', 'agent'])
      expect(result.data.vmids).toEqual([101, 102])
    }
  })

  it('rejects invalid enum value in levels array', () => {
    const result = LogQueryParamsSchema.safeParse({ levels: ['info', 'critical'] })
    expect(result.success).toBe(false)
  })

  it('rejects invalid enum value in sources array', () => {
    const result = LogQueryParamsSchema.safeParse({ sources: ['app', 'unknown'] })
    expect(result.success).toBe(false)
  })

  it('rejects limit above 500', () => {
    const result = LogQueryParamsSchema.safeParse({ limit: 501 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid searchMode', () => {
    const result = LogQueryParamsSchema.safeParse({ searchMode: 'fuzzy' })
    expect(result.success).toBe(false)
  })
})

describe('LogStatsParamsSchema', () => {
  it('defaults bucket to hour', () => {
    const result = LogStatsParamsSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.bucket).toBe('hour')
    }
  })

  it('accepts all valid bucket values', () => {
    for (const bucket of ['minute', 'hour', 'day']) {
      const result = LogStatsParamsSchema.safeParse({ bucket })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid bucket', () => {
    const result = LogStatsParamsSchema.safeParse({ bucket: 'week' })
    expect(result.success).toBe(false)
  })
})

describe('SavedLogFilterSchema', () => {
  const validFilter = {
    id: crypto.randomUUID(),
    name: 'Errors only',
    filter: { levels: ['error', 'fatal'], limit: 100 },
    createdAt: new Date().toISOString(),
  }

  it('parses a valid saved filter', () => {
    const result = SavedLogFilterSchema.safeParse(validFilter)
    expect(result.success).toBe(true)
  })

  it('rejects name longer than 100 characters', () => {
    const result = SavedLogFilterSchema.safeParse({ ...validFilter, name: 'x'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = SavedLogFilterSchema.safeParse({ ...validFilter, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid id (not a UUID)', () => {
    const result = SavedLogFilterSchema.safeParse({ ...validFilter, id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('safeParse returns error for missing required fields', () => {
    const result = SavedLogFilterSchema.safeParse({ name: 'test' })
    expect(result.success).toBe(false)
  })
})
