import { z } from 'zod'
import { GuestMetricsSchema, NodeMetricsSchema } from './proxmox.js'
import { DeployJobSchema, DeployLogLineSchema } from './deploy.js'
import { LogEntryRowSchema } from './logs.js'
import { AgentCommandSchema, AgentHeartbeatSchema, AgentResultSchema, AgentSchema } from './agent.js'
import { ProvisioningJobSchema } from './provisioning.js'

// ── Client → Server ───────────────────────────────────────────────────────

export const ClientMessageSchema = z.discriminatedUnion('type', [
  // Authenticate the WebSocket connection after opening
  z.object({
    type: z.literal('auth'),
    token: z.string(),
  }),

  // Subscribe to live metrics for a guest
  z.object({
    type: z.literal('subscribe_metrics'),
    nodeId: z.string().uuid(),
    vmid: z.number().int().positive(),
  }),

  z.object({
    type: z.literal('unsubscribe_metrics'),
    nodeId: z.string().uuid(),
    vmid: z.number().int().positive(),
  }),

  // Subscribe to live log stream for a container
  z.object({
    type: z.literal('subscribe_logs'),
    vmid: z.number().int().positive(),
  }),

  z.object({
    type: z.literal('unsubscribe_logs'),
    vmid: z.number().int().positive(),
  }),

  // Subscribe to deploy job output
  z.object({
    type: z.literal('subscribe_deploy'),
    jobId: z.string().uuid(),
  }),

  z.object({
    type: z.literal('unsubscribe_deploy'),
    jobId: z.string().uuid(),
  }),

  // Open a terminal session (SSH PTY)
  z.object({
    type: z.literal('terminal_open'),
    sessionId: z.string().uuid(),
    nodeId: z.string().uuid(),
    vmid: z.number().int().positive(),
    cols: z.number().int().positive().default(80),
    rows: z.number().int().positive().default(24),
  }),

  z.object({
    type: z.literal('terminal_input'),
    sessionId: z.string().uuid(),
    data: z.string(),
  }),

  z.object({
    type: z.literal('terminal_resize'),
    sessionId: z.string().uuid(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),

  z.object({
    type: z.literal('terminal_close'),
    sessionId: z.string().uuid(),
  }),

  // Subscribe to control-plane stdout/stderr (admin only)
  z.object({ type: z.literal('subscribe_control_logs') }),
  z.object({ type: z.literal('unsubscribe_control_logs') }),

  // Run a command inside an LXC container and stream output (admin only)
  z.object({
    type: z.literal('diagnostic_exec'),
    requestId: z.string().uuid(),
    nodeId: z.string().uuid(),
    vmid: z.number().int().positive(),
    command: z.array(z.string().min(1)).min(1),
  }),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

// ── Server → Client ───────────────────────────────────────────────────────

export const ServerMessageSchema = z.discriminatedUnion('type', [
  // Auth result
  z.object({
    type: z.literal('auth_ok'),
    userId: z.string().uuid(),
    role: z.string(),
  }),
  z.object({
    type: z.literal('auth_error'),
    message: z.string(),
  }),

  // Metrics pushes
  z.object({
    type: z.literal('metrics_guest'),
    data: GuestMetricsSchema,
  }),
  z.object({
    type: z.literal('metrics_node'),
    data: NodeMetricsSchema,
  }),

  // Live log line from a container
  z.object({
    type: z.literal('log_line'),
    data: LogEntryRowSchema,
  }),

  // Deploy updates
  z.object({
    type: z.literal('deploy_update'),
    data: DeployJobSchema,
  }),
  z.object({
    type: z.literal('deploy_log'),
    data: DeployLogLineSchema,
  }),

  // Terminal output
  z.object({
    type: z.literal('terminal_output'),
    sessionId: z.string().uuid(),
    data: z.string(),
  }),
  z.object({
    type: z.literal('terminal_closed'),
    sessionId: z.string().uuid(),
    reason: z.string().optional(),
  }),

  // Provisioning job state transitions
  z.object({
    type: z.literal('provisioning_update'),
    data: ProvisioningJobSchema,
  }),

  // Control-plane log stream
  z.object({
    type: z.literal('control_log'),
    stream: z.enum(['stdout', 'stderr']),
    data: z.string(),
    ts: z.number(),
  }),

  // Diagnostic exec streaming
  z.object({
    type: z.literal('diagnostic_output'),
    requestId: z.string().uuid(),
    stream: z.enum(['stdout', 'stderr']),
    data: z.string(),
  }),
  z.object({
    type: z.literal('diagnostic_done'),
    requestId: z.string().uuid(),
    exitCode: z.number().int().nullable(),
    error: z.string().optional(),
  }),

  // Agent status updates
  z.object({
    type: z.literal('agent_status'),
    data: AgentSchema,
  }),

  // Generic error
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
])
export type ServerMessage = z.infer<typeof ServerMessageSchema>

// ── Agent WebSocket messages ───────────────────────────────────────────────
// Separate connection, separate message shapes

export const AgentClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    agentId: z.string().uuid(),
    token: z.string(),
  }),
  z.object({
    type: z.literal('result'),
    payload: AgentResultSchema,
  }),
  z.object({
    type: z.literal('heartbeat'),
    payload: AgentHeartbeatSchema,
  }),
])
export type AgentClientMessage = z.infer<typeof AgentClientMessageSchema>

export const AgentServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth_ok'),
  }),
  z.object({
    type: z.literal('command'),
    payload: AgentCommandSchema,
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
])
export type AgentServerMessage = z.infer<typeof AgentServerMessageSchema>
