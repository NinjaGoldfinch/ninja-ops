import { z } from 'zod'

// ── Agent identity ────────────────────────────────────────────────────────

export const AgentStatusSchema = z.enum(['idle', 'busy', 'offline'])
export type AgentStatus = z.infer<typeof AgentStatusSchema>

export const AgentKindSchema = z.enum(['deploy', 'log'])
export type AgentKind = z.infer<typeof AgentKindSchema>

export const AgentSchema = z.object({
  id: z.string().uuid(),
  nodeId: z.string().uuid(),
  vmid: z.number().int().positive(),
  hostname: z.string(),
  version: z.string(),              // semver of the agent package
  kind: AgentKindSchema,
  status: AgentStatusSchema,
  lastSeenAt: z.string().datetime(),
  registeredAt: z.string().datetime(),
})
export type Agent = z.infer<typeof AgentSchema>

// ── Registration ──────────────────────────────────────────────────────────

export const AgentRegisterRequestSchema = z.object({
  nodeId: z.string().uuid(),
  vmid: z.number().int().positive(),
  hostname: z.string(),
  version: z.string(),
  secret: z.string().min(32),       // shared secret, set in agent env
})
export type AgentRegisterRequest = z.infer<typeof AgentRegisterRequestSchema>

export const AgentRegisterResponseSchema = z.object({
  agentId: z.string().uuid(),
  token: z.string(),                // short-lived JWT for subsequent messages
})
export type AgentRegisterResponse = z.infer<typeof AgentRegisterResponseSchema>

// ── Heartbeat ─────────────────────────────────────────────────────────────

export const AgentHeartbeatSchema = z.object({
  agentId: z.string().uuid(),
  status: AgentStatusSchema,
  currentJobId: z.string().uuid().nullable(),
  timestamp: z.string().datetime(),
})
export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>

// ── Command dispatch ──────────────────────────────────────────────────────
// Control plane → agent

export const AgentCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('deploy'),
    jobId: z.string().uuid(),
    workingDir: z.string(),
    preDeployCommand: z.string().optional(),
    restartCommand: z.string(),
    postDeployCommand: z.string().optional(),
    timeoutSeconds: z.number().int().positive(),
    commitSha: z.string().length(40),
  }),
  z.object({
    type: z.literal('cancel'),
    jobId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('ping'),
  }),
])
export type AgentCommand = z.infer<typeof AgentCommandSchema>

// ── Command result ────────────────────────────────────────────────────────
// Agent → control plane

export const AgentResultSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('deploy_started'),
    jobId: z.string().uuid(),
    agentId: z.string().uuid(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal('deploy_log'),
    jobId: z.string().uuid(),
    seq: z.number().int().nonnegative(),
    stream: z.enum(['stdout', 'stderr']),
    line: z.string(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal('deploy_finished'),
    jobId: z.string().uuid(),
    exitCode: z.number().int(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal('pong'),
    agentId: z.string().uuid(),
    timestamp: z.string().datetime(),
  }),
])
export type AgentResult = z.infer<typeof AgentResultSchema>
