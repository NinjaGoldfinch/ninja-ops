import { describe, it, expect } from 'vitest'
import {
  POWER_STATES,
  POWER_ACTIONS,
  NodeStatusSchema,
  ProxmoxNodeSchema,
  CreateNodeRequestSchema,
  GuestTypeSchema,
  PowerStateSchema,
  PowerActionSchema,
  GuestSchema,
  GuestMetricsSchema,
  NodeMetricsSchema,
  SnapshotSchema,
  CreateSnapshotRequestSchema,
  PowerActionRequestSchema,
} from '../proxmox.js'

describe('POWER_STATES', () => {
  it('contains all expected states', () => {
    expect(POWER_STATES).toContain('running')
    expect(POWER_STATES).toContain('stopped')
    expect(POWER_STATES).toContain('paused')
    expect(POWER_STATES).toContain('unknown')
  })
})

describe('POWER_ACTIONS', () => {
  it('contains all expected actions', () => {
    expect(POWER_ACTIONS).toContain('start')
    expect(POWER_ACTIONS).toContain('stop')
    expect(POWER_ACTIONS).toContain('reboot')
    expect(POWER_ACTIONS).toContain('shutdown')
    expect(POWER_ACTIONS).toContain('suspend')
    expect(POWER_ACTIONS).toContain('resume')
  })
})

describe('NodeStatusSchema', () => {
  it('parses valid node statuses', () => {
    expect(NodeStatusSchema.parse('online')).toBe('online')
    expect(NodeStatusSchema.parse('offline')).toBe('offline')
    expect(NodeStatusSchema.parse('unknown')).toBe('unknown')
  })

  it('rejects invalid status', () => {
    expect(NodeStatusSchema.safeParse('degraded').success).toBe(false)
  })
})

describe('ProxmoxNodeSchema', () => {
  const validNode = {
    id: crypto.randomUUID(),
    name: 'pve-01',
    host: '192.168.1.100',
    port: 8006,
    tokenId: 'manager@pve!app',
    status: 'online',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('parses a valid node', () => {
    expect(ProxmoxNodeSchema.safeParse(validNode).success).toBe(true)
  })

  it('applies default port of 8006', () => {
    const { port: _port, ...noPort } = validNode
    const result = ProxmoxNodeSchema.safeParse(noPort)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.port).toBe(8006)
    }
  })

  it('rejects port out of range', () => {
    const result = ProxmoxNodeSchema.safeParse({ ...validNode, port: 99999 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('port')
    }
  })
})

describe('CreateNodeRequestSchema', () => {
  it('parses a valid create node request (includes tokenSecret)', () => {
    const result = CreateNodeRequestSchema.safeParse({
      name: 'pve-01',
      host: '10.0.0.1',
      tokenId: 'root@pam!tok',
      tokenSecret: 'supersecretvalue',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing tokenSecret', () => {
    const result = CreateNodeRequestSchema.safeParse({
      name: 'pve-01',
      host: '10.0.0.1',
      tokenId: 'root@pam!tok',
    })
    expect(result.success).toBe(false)
  })
})

describe('GuestTypeSchema', () => {
  it('parses lxc and qemu', () => {
    expect(GuestTypeSchema.parse('lxc')).toBe('lxc')
    expect(GuestTypeSchema.parse('qemu')).toBe('qemu')
  })

  it('rejects unknown guest type', () => {
    expect(GuestTypeSchema.safeParse('docker').success).toBe(false)
  })
})

describe('GuestSchema', () => {
  const validGuest = {
    vmid: 100,
    name: 'skyblock-api',
    type: 'lxc',
    status: 'running',
    nodeId: crypto.randomUUID(),
    nodeName: 'pve-01',
  }

  it('parses a valid guest', () => {
    expect(GuestSchema.safeParse(validGuest).success).toBe(true)
  })

  it('rejects non-positive vmid', () => {
    const result = GuestSchema.safeParse({ ...validGuest, vmid: 0 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('vmid')
    }
  })
})

describe('GuestMetricsSchema', () => {
  it('parses valid guest metrics', () => {
    const result = GuestMetricsSchema.safeParse({
      vmid: 100,
      nodeId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      cpu: 0.45,
      mem: 512 * 1024 * 1024,
      maxmem: 2 * 1024 * 1024 * 1024,
      disk: 10 * 1024 * 1024 * 1024,
      maxdisk: 50 * 1024 * 1024 * 1024,
      netin: 1024,
      netout: 2048,
    })
    expect(result.success).toBe(true)
  })

  it('rejects cpu > 1', () => {
    const result = GuestMetricsSchema.safeParse({
      vmid: 100,
      nodeId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      cpu: 1.5,
      mem: 0,
      maxmem: 0,
      disk: 0,
      maxdisk: 0,
      netin: 0,
      netout: 0,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('cpu')
    }
  })
})

describe('NodeMetricsSchema', () => {
  it('parses valid node metrics', () => {
    const result = NodeMetricsSchema.safeParse({
      nodeId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      cpu: 0.2,
      mem: 4 * 1024 * 1024 * 1024,
      maxmem: 16 * 1024 * 1024 * 1024,
      disk: 20 * 1024 * 1024 * 1024,
      maxdisk: 500 * 1024 * 1024 * 1024,
      uptime: 86400,
    })
    expect(result.success).toBe(true)
  })
})

describe('CreateSnapshotRequestSchema', () => {
  it('parses a valid snapshot request', () => {
    const result = CreateSnapshotRequestSchema.safeParse({
      name: 'before-upgrade',
      description: 'Pre-upgrade snapshot',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.vmstate).toBe(false)
    }
  })

  it('rejects name with invalid characters', () => {
    const result = CreateSnapshotRequestSchema.safeParse({ name: 'bad name!' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain('name')
    }
  })

  it('rejects name longer than 40 chars', () => {
    const result = CreateSnapshotRequestSchema.safeParse({ name: 'a'.repeat(41) })
    expect(result.success).toBe(false)
  })
})

describe('PowerActionRequestSchema', () => {
  it('parses all valid power actions', () => {
    for (const action of POWER_ACTIONS) {
      expect(PowerActionRequestSchema.safeParse({ action }).success).toBe(true)
    }
  })

  it('rejects invalid action', () => {
    expect(PowerActionRequestSchema.safeParse({ action: 'explode' }).success).toBe(false)
  })
})
