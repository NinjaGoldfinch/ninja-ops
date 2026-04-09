import { z } from 'zod'

// ── Node ──────────────────────────────────────────────────────────────────

export const NodeStatusSchema = z.enum(['online', 'offline', 'unknown'])
export type NodeStatus = z.infer<typeof NodeStatusSchema>

export const ProxmoxNodeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  host: z.string().min(1),        // IP or hostname
  port: z.number().int().min(1).max(65535).default(8006),
  tokenId: z.string().min(1),     // e.g. manager@pve!app
  // tokenSecret is never exposed in responses — omitted here, stored encrypted
  status: NodeStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type ProxmoxNode = z.infer<typeof ProxmoxNodeSchema>

export const CreateNodeRequestSchema = ProxmoxNodeSchema.omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  tokenSecret: z.string().min(1),
})
export type CreateNodeRequest = z.infer<typeof CreateNodeRequestSchema>

// ── Guest (VM or LXC container) ───────────────────────────────────────────

export const GuestTypeSchema = z.enum(['lxc', 'qemu'])
export type GuestType = z.infer<typeof GuestTypeSchema>

export const POWER_STATES = ['running', 'stopped', 'paused', 'unknown'] as const
export const PowerStateSchema = z.enum(POWER_STATES)
export type PowerState = z.infer<typeof PowerStateSchema>

export const POWER_ACTIONS = ['start', 'stop', 'reboot', 'shutdown', 'suspend', 'resume'] as const
export const PowerActionSchema = z.enum(POWER_ACTIONS)
export type PowerAction = z.infer<typeof PowerActionSchema>

export const GuestSchema = z.object({
  vmid: z.number().int().positive(),
  name: z.string(),
  type: GuestTypeSchema,
  status: PowerStateSchema,
  nodeId: z.string().uuid(),
  nodeName: z.string(),
  cpus: z.number().optional(),
  maxmem: z.number().optional(),   // bytes
  maxdisk: z.number().optional(),  // bytes
  uptime: z.number().optional(),   // seconds
  tags: z.array(z.string()).optional(),
})
export type Guest = z.infer<typeof GuestSchema>

// ── Metrics ───────────────────────────────────────────────────────────────

export const GuestMetricsSchema = z.object({
  vmid: z.number().int().positive(),
  nodeId: z.string().uuid(),
  timestamp: z.string().datetime(),
  cpu: z.number().min(0).max(1),          // fraction 0–1
  mem: z.number().nonnegative(),          // bytes used
  maxmem: z.number().nonnegative(),       // bytes total
  disk: z.number().nonnegative(),         // bytes used
  maxdisk: z.number().nonnegative(),
  netin: z.number().nonnegative(),        // bytes/s
  netout: z.number().nonnegative(),
})
export type GuestMetrics = z.infer<typeof GuestMetricsSchema>

export const NodeMetricsSchema = z.object({
  nodeId: z.string().uuid(),
  timestamp: z.string().datetime(),
  cpu: z.number().min(0).max(1),
  mem: z.number().nonnegative(),
  maxmem: z.number().nonnegative(),
  disk: z.number().nonnegative(),
  maxdisk: z.number().nonnegative(),
  uptime: z.number().nonnegative(),
})
export type NodeMetrics = z.infer<typeof NodeMetricsSchema>

// ── Snapshots ─────────────────────────────────────────────────────────────

export const SnapshotSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  snaptime: z.number(),     // unix timestamp from Proxmox
  vmstate: z.boolean(),     // whether RAM was included
  parent: z.string().optional(),
})
export type Snapshot = z.infer<typeof SnapshotSchema>

export const CreateSnapshotRequestSchema = z.object({
  name: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().max(256).optional(),
  vmstate: z.boolean().default(false),
})
export type CreateSnapshotRequest = z.infer<typeof CreateSnapshotRequestSchema>

// ── Power action request ──────────────────────────────────────────────────

export const PowerActionRequestSchema = z.object({
  action: PowerActionSchema,
})
export type PowerActionRequest = z.infer<typeof PowerActionRequestSchema>
