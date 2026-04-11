import { z } from 'zod'

// ── Provisioning state ────────────────────────────────────────────────────

export const PROVISIONING_STATES = [
  'pending',
  'creating',
  'starting',
  'deploying',
  'done',
  'failed',
] as const

export const ProvisioningStateSchema = z.enum(PROVISIONING_STATES)
export type ProvisioningState = z.infer<typeof ProvisioningStateSchema>

// ── Provisioning job ──────────────────────────────────────────────────────

export const ProvisioningJobSchema = z.object({
  id:           z.string().uuid(),
  nodeId:       z.string().uuid(),
  guestType:    z.enum(['lxc', 'qemu']),
  vmid:         z.number().int(),
  name:         z.string(),
  proxmoxUpid:  z.string().nullable(),
  state:        ProvisioningStateSchema,
  deployAgent:    z.boolean(),
  deployLogAgent: z.boolean(),
  errorMessage: z.string().nullable(),
  createdAt:    z.string().datetime(),
  updatedAt:    z.string().datetime(),
})
export type ProvisioningJob = z.infer<typeof ProvisioningJobSchema>

// ── LXC creation request ──────────────────────────────────────────────────

const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/

export const LxcCreateRequestSchema = z.object({
  nodeId:      z.string().uuid(),
  vmid:        z.number().int().min(100).max(999_999_999).optional(),
  hostname:    z.string().min(1).max(63).regex(
    hostnameRegex,
    'Must be a valid hostname (alphanumeric and hyphens, no leading/trailing hyphen)',
  ),
  osTemplate:  z.string().min(1),
  cores:       z.number().int().min(1).max(128),
  memory:      z.number().int().min(64).max(1_048_576),
  swap:        z.number().int().min(0).max(65_536).default(512),
  diskSize:    z.number().int().min(1).max(65_536),
  storage:     z.string().min(1),
  bridge:      z.string().default('vmbr0'),
  ipConfig:    z.union([
    z.object({ type: z.literal('dhcp') }),
    z.object({
      type:    z.literal('static'),
      address: z.string().ip({ version: 'v4' }),
      prefix:  z.number().int().min(1).max(32),
      gateway: z.string().ip({ version: 'v4' }),
    }),
  ]),
  dns:              z.string().optional(),
  password:         z.string().min(8).optional(),
  sshPublicKey:     z.string().optional(),
  unprivileged:     z.boolean().default(true),
  startOnBoot:      z.boolean().default(true),
  startAfterCreate: z.boolean().default(true),
  tags:             z.array(z.string()).default([]),
  deployAgent:      z.boolean().default(false),
  deployLogAgent:   z.boolean().default(false),
})
export type LxcCreateRequest = z.infer<typeof LxcCreateRequestSchema>

// ── QEMU VM creation request ──────────────────────────────────────────────

export const QemuCreateRequestSchema = z.object({
  nodeId:     z.string().uuid(),
  vmid:       z.number().int().min(100).max(999_999_999).optional(),
  name:       z.string().min(1).max(63).regex(
    hostnameRegex,
    'Must be a valid name (alphanumeric and hyphens, no leading/trailing hyphen)',
  ),
  osType:     z.enum(['l26', 'l24', 'win11', 'win10', 'win2k22', 'other']),
  isoImage:   z.string().min(1),
  cores:      z.number().int().min(1).max(128),
  sockets:    z.number().int().min(1).max(4).default(1),
  memory:     z.number().int().min(256).max(1_048_576),
  diskSize:   z.number().int().min(1).max(65_536),
  storage:    z.string().min(1),
  diskFormat: z.enum(['raw', 'qcow2', 'vmdk']).default('raw'),
  bridge:     z.string().default('vmbr0'),
  netModel:   z.enum(['virtio', 'e1000', 'rtl8139']).default('virtio'),
  bios:       z.enum(['seabios', 'ovmf']).default('seabios'),
  startOnBoot:      z.boolean().default(true),
  startAfterCreate: z.boolean().default(false),
  tags:       z.array(z.string()).default([]),
})
export type QemuCreateRequest = z.infer<typeof QemuCreateRequestSchema>

// ── Discovery types ───────────────────────────────────────────────────────

export const ProxmoxTemplateSchema = z.object({
  volid:   z.string(),
  name:    z.string(),
  size:    z.number(),
  storage: z.string(),
})
export type ProxmoxTemplate = z.infer<typeof ProxmoxTemplateSchema>

export const ProxmoxIsoSchema = z.object({
  volid:   z.string(),
  name:    z.string(),
  size:    z.number(),
  storage: z.string(),
})
export type ProxmoxIso = z.infer<typeof ProxmoxIsoSchema>

export const ProxmoxStorageSchema = z.object({
  storage: z.string(),
  type:    z.string(),
  avail:   z.number(),
  total:   z.number(),
  content: z.array(z.string()),
  enabled: z.boolean(),
})
export type ProxmoxStorage = z.infer<typeof ProxmoxStorageSchema>
