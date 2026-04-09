import { describe, it, expect } from 'vitest'
import {
  ClientMessageSchema,
  ServerMessageSchema,
  AgentClientMessageSchema,
  AgentServerMessageSchema,
} from '../websocket.js'

describe('ClientMessageSchema', () => {
  it('parses an auth message', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'auth',
      token: 'eyJhbGciOiJIUzI1NiJ9.test.sig',
    })
    expect(result.success).toBe(true)
  })

  it('parses a subscribe_metrics message', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'subscribe_metrics',
      nodeId: crypto.randomUUID(),
      vmid: 100,
    })
    expect(result.success).toBe(true)
  })

  it('parses a subscribe_logs message', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'subscribe_logs',
      subscription: {
        source: { kind: 'control-plane' },
        levels: ['error'],
      },
    })
    expect(result.success).toBe(true)
  })

  it('parses a terminal_open message with defaults', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'terminal_open',
      sessionId: crypto.randomUUID(),
      nodeId: crypto.randomUUID(),
      vmid: 100,
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === 'terminal_open') {
      expect(result.data.cols).toBe(80)
      expect(result.data.rows).toBe(24)
    }
  })

  it('parses a terminal_input message', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'terminal_input',
      sessionId: crypto.randomUUID(),
      data: 'ls -la\n',
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown message type', () => {
    const result = ClientMessageSchema.safeParse({ type: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('rejects subscribe_metrics with non-positive vmid', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'subscribe_metrics',
      nodeId: crypto.randomUUID(),
      vmid: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('ServerMessageSchema', () => {
  it('parses auth_ok message', () => {
    const result = ServerMessageSchema.safeParse({
      type: 'auth_ok',
      userId: crypto.randomUUID(),
      role: 'admin',
    })
    expect(result.success).toBe(true)
  })

  it('parses auth_error message', () => {
    const result = ServerMessageSchema.safeParse({
      type: 'auth_error',
      message: 'Invalid token',
    })
    expect(result.success).toBe(true)
  })

  it('parses metrics_guest message', () => {
    const result = ServerMessageSchema.safeParse({
      type: 'metrics_guest',
      data: {
        vmid: 100,
        nodeId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        cpu: 0.3,
        mem: 512,
        maxmem: 1024,
        disk: 1000,
        maxdisk: 5000,
        netin: 100,
        netout: 200,
      },
    })
    expect(result.success).toBe(true)
  })

  it('parses error message', () => {
    const result = ServerMessageSchema.safeParse({
      type: 'error',
      code: 'UNAUTHORIZED',
      message: 'Not authorized',
    })
    expect(result.success).toBe(true)
  })

  it('parses terminal_output message', () => {
    const result = ServerMessageSchema.safeParse({
      type: 'terminal_output',
      sessionId: crypto.randomUUID(),
      data: 'total 0\n',
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown server message type', () => {
    const result = ServerMessageSchema.safeParse({ type: 'push_notification' })
    expect(result.success).toBe(false)
  })
})

describe('AgentClientMessageSchema', () => {
  it('parses agent auth message', () => {
    const result = AgentClientMessageSchema.safeParse({
      type: 'auth',
      agentId: crypto.randomUUID(),
      token: 'some-token',
    })
    expect(result.success).toBe(true)
  })

  it('parses agent heartbeat message', () => {
    const result = AgentClientMessageSchema.safeParse({
      type: 'heartbeat',
      payload: {
        agentId: crypto.randomUUID(),
        status: 'idle',
        currentJobId: null,
        timestamp: new Date().toISOString(),
      },
    })
    expect(result.success).toBe(true)
  })

  it('parses agent result message', () => {
    const result = AgentClientMessageSchema.safeParse({
      type: 'result',
      payload: {
        type: 'pong',
        agentId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('AgentServerMessageSchema', () => {
  it('parses auth_ok', () => {
    const result = AgentServerMessageSchema.safeParse({ type: 'auth_ok' })
    expect(result.success).toBe(true)
  })

  it('parses command message', () => {
    const result = AgentServerMessageSchema.safeParse({
      type: 'command',
      payload: { type: 'ping' },
    })
    expect(result.success).toBe(true)
  })

  it('parses error message', () => {
    const result = AgentServerMessageSchema.safeParse({
      type: 'error',
      code: 'UNAUTHORIZED',
      message: 'Bad token',
    })
    expect(result.success).toBe(true)
  })
})
