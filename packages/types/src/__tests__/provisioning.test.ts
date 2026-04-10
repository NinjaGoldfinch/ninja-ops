import { describe, it, expect } from 'vitest'
import {
  LxcCreateRequestSchema,
  QemuCreateRequestSchema,
  ProvisioningJobSchema,
  ProvisioningStateSchema,
} from '../provisioning.js'

// ── ProvisioningStateSchema ───────────────────────────────────────────────

describe('ProvisioningStateSchema', () => {
  it('parses all valid states', () => {
    for (const state of ['pending', 'creating', 'starting', 'deploying', 'done', 'failed']) {
      expect(ProvisioningStateSchema.safeParse(state).success).toBe(true)
    }
  })

  it('rejects unknown state', () => {
    expect(ProvisioningStateSchema.safeParse('running').success).toBe(false)
  })
})

// ── LxcCreateRequestSchema ────────────────────────────────────────────────

const validLxc = {
  nodeId: crypto.randomUUID(),
  hostname: 'web-01',
  osTemplate: 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst',
  cores: 2,
  memory: 512,
  diskSize: 8,
  storage: 'local-lvm',
  ipConfig: { type: 'dhcp' as const },
}

describe('LxcCreateRequestSchema', () => {
  it('parses a minimal valid LXC request with defaults', () => {
    const result = LxcCreateRequestSchema.safeParse(validLxc)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.swap).toBe(512)
      expect(result.data.bridge).toBe('vmbr0')
      expect(result.data.unprivileged).toBe(true)
      expect(result.data.startOnBoot).toBe(true)
      expect(result.data.startAfterCreate).toBe(true)
      expect(result.data.deployAgent).toBe(false)
      expect(result.data.tags).toEqual([])
    }
  })

  it('parses a static IP config', () => {
    const result = LxcCreateRequestSchema.safeParse({
      ...validLxc,
      ipConfig: { type: 'static', address: '192.168.1.100', prefix: 24, gateway: '192.168.1.1' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects static IP config missing required fields', () => {
    const result = LxcCreateRequestSchema.safeParse({
      ...validLxc,
      ipConfig: { type: 'static', address: '192.168.1.100' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid hostname — starts with hyphen', () => {
    expect(LxcCreateRequestSchema.safeParse({ ...validLxc, hostname: '-invalid' }).success).toBe(false)
  })

  it('rejects invalid hostname — ends with hyphen', () => {
    expect(LxcCreateRequestSchema.safeParse({ ...validLxc, hostname: 'invalid-' }).success).toBe(false)
  })

  it('rejects hostname longer than 63 chars', () => {
    expect(LxcCreateRequestSchema.safeParse({
      ...validLxc,
      hostname: 'a'.repeat(64),
    }).success).toBe(false)
  })

  it('rejects VMID below 100', () => {
    expect(LxcCreateRequestSchema.safeParse({ ...validLxc, vmid: 99 }).success).toBe(false)
  })

  it('rejects VMID above 999999999', () => {
    expect(LxcCreateRequestSchema.safeParse({ ...validLxc, vmid: 1_000_000_000 }).success).toBe(false)
  })

  it('allows VMID to be omitted (auto-assign)', () => {
    const result = LxcCreateRequestSchema.safeParse(validLxc)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.vmid).toBeUndefined()
  })

  it('rejects memory below minimum (64 MB)', () => {
    expect(LxcCreateRequestSchema.safeParse({ ...validLxc, memory: 32 }).success).toBe(false)
  })

  it('rejects cores below 1', () => {
    expect(LxcCreateRequestSchema.safeParse({ ...validLxc, cores: 0 }).success).toBe(false)
  })

  it('accepts optional password when >= 8 chars', () => {
    expect(LxcCreateRequestSchema.safeParse({ ...validLxc, password: 'hunter42' }).success).toBe(true)
  })

  it('rejects password shorter than 8 chars', () => {
    expect(LxcCreateRequestSchema.safeParse({ ...validLxc, password: 'short' }).success).toBe(false)
  })
})

// ── QemuCreateRequestSchema ───────────────────────────────────────────────

const validQemu = {
  nodeId: crypto.randomUUID(),
  name: 'vm-debian',
  osType: 'l26' as const,
  isoImage: 'local:iso/debian-12.5.0-amd64-netinst.iso',
  cores: 2,
  memory: 2048,
  diskSize: 32,
  storage: 'local-lvm',
}

describe('QemuCreateRequestSchema', () => {
  it('parses a minimal valid QEMU request with defaults', () => {
    const result = QemuCreateRequestSchema.safeParse(validQemu)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sockets).toBe(1)
      expect(result.data.diskFormat).toBe('raw')
      expect(result.data.bridge).toBe('vmbr0')
      expect(result.data.netModel).toBe('virtio')
      expect(result.data.bios).toBe('seabios')
      expect(result.data.startOnBoot).toBe(true)
      expect(result.data.startAfterCreate).toBe(false)
    }
  })

  it('rejects invalid osType', () => {
    expect(QemuCreateRequestSchema.safeParse({ ...validQemu, osType: 'linux' }).success).toBe(false)
  })

  it('rejects invalid name — starts with hyphen', () => {
    expect(QemuCreateRequestSchema.safeParse({ ...validQemu, name: '-bad' }).success).toBe(false)
  })

  it('rejects memory below 256 MB', () => {
    expect(QemuCreateRequestSchema.safeParse({ ...validQemu, memory: 128 }).success).toBe(false)
  })

  it('rejects diskFormat not in allowed set', () => {
    expect(QemuCreateRequestSchema.safeParse({ ...validQemu, diskFormat: 'ext4' }).success).toBe(false)
  })

  it('accepts all valid osType values', () => {
    for (const osType of ['l26', 'l24', 'win11', 'win10', 'win2k22', 'other']) {
      expect(QemuCreateRequestSchema.safeParse({ ...validQemu, osType }).success).toBe(true)
    }
  })
})

// ── ProvisioningJobSchema ─────────────────────────────────────────────────

describe('ProvisioningJobSchema', () => {
  const validJob = {
    id: crypto.randomUUID(),
    nodeId: crypto.randomUUID(),
    guestType: 'lxc' as const,
    vmid: 101,
    name: 'web-01',
    proxmoxUpid: null,
    state: 'pending' as const,
    deployAgent: false,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('parses a valid provisioning job', () => {
    expect(ProvisioningJobSchema.safeParse(validJob).success).toBe(true)
  })

  it('parses a failed job with errorMessage', () => {
    expect(ProvisioningJobSchema.safeParse({
      ...validJob,
      state: 'failed',
      errorMessage: 'Timeout waiting for guest to start',
    }).success).toBe(true)
  })

  it('rejects unknown guestType', () => {
    expect(ProvisioningJobSchema.safeParse({ ...validJob, guestType: 'openvz' }).success).toBe(false)
  })
})
