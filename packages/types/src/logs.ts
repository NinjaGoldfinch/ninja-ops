import { z } from 'zod'

// ── Log levels ────────────────────────────────────────────────────────────

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
export const LogLevelSchema = z.enum(LOG_LEVELS)
export type LogLevel = z.infer<typeof LogLevelSchema>

// ── Log sources ───────────────────────────────────────────────────────────

export const LogSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('guest'),     // log from inside an LXC/VM
    nodeId: z.string().uuid(),
    vmid: z.number().int().positive(),
    service: z.string().optional(),
  }),
  z.object({
    kind: z.literal('host'),      // log from the Proxmox host itself
    nodeId: z.string().uuid(),
    service: z.string().optional(),
  }),
  z.object({
    kind: z.literal('control-plane'),
    service: z.string().optional(),
  }),
])
export type LogSource = z.infer<typeof LogSourceSchema>

// ── Log entry ─────────────────────────────────────────────────────────────
// Normalised shape regardless of origin (journald, stdout, syslog, Pino JSON)

export const LogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  level: LogLevelSchema.optional(),
  message: z.string(),
  source: LogSourceSchema,
  raw: z.string().optional(),           // original unparsed line
  fields: z.record(z.unknown()).optional(),  // extra structured fields
})
export type LogEntry = z.infer<typeof LogEntrySchema>

// ── Loki label set ─────────────────────────────────────────────────────────
// Labels attached by Vector agents when shipping to Loki

export const LokiLabelsSchema = z.object({
  source: z.enum(['guest', 'host', 'control-plane']),
  node_id: z.string().optional(),
  vmid: z.string().optional(),       // Loki labels are strings
  service: z.string().optional(),
  environment: z.string().optional(),
})
export type LokiLabels = z.infer<typeof LokiLabelsSchema>

// ── Log query parameters ──────────────────────────────────────────────────

export const LogQuerySchema = z.object({
  source: LogSourceSchema.optional(),
  level: LogLevelSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().max(256).optional(),
  limit: z.number().int().min(1).max(5000).default(200),
  direction: z.enum(['forward', 'backward']).default('backward'),
})
export type LogQuery = z.infer<typeof LogQuerySchema>

// ── Log stream subscription (for WebSocket) ───────────────────────────────

export const LogSubscriptionSchema = z.object({
  source: LogSourceSchema,
  levels: z.array(LogLevelSchema).optional(),
  search: z.string().max(256).optional(),
})
export type LogSubscription = z.infer<typeof LogSubscriptionSchema>

// ── Log agent registration ────────────────────────────────────────────────

export const LogAgentRegisterRequestSchema = z.object({
  nodeId:   z.string().uuid(),
  vmid:     z.number().int().positive(),
  secret:   z.string().min(32),
  version:  z.string(),
  hostname: z.string().optional(),
})
export type LogAgentRegisterRequest = z.infer<typeof LogAgentRegisterRequestSchema>

export const LogAgentRegisterResponseSchema = z.object({
  agentId: z.string().uuid(),
  token:   z.string(),
})
export type LogAgentRegisterResponse = z.infer<typeof LogAgentRegisterResponseSchema>

// ── Log entry (API response / DB row shape) ───────────────────────────────

export const LOG_SOURCES = ['app', 'agent', 'shell', 'system'] as const
export const LogEntryRowSchema = z.object({
  id:     z.number().int(),
  vmid:   z.number().int(),
  nodeId: z.string().uuid(),
  source: z.enum(LOG_SOURCES),
  unit:   z.string().nullable(),
  level:  LogLevelSchema,
  line:   z.string(),
  ts:     z.number().int(),   // unix ms
})
export type LogEntryRow = z.infer<typeof LogEntryRowSchema>

// ── WebSocket message shapes (/ws/log-agent) ─────────────────────────────

// log-agent → control plane
export const LogAgentClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type:    z.literal('auth'),
    agentId: z.string().uuid(),
    token:   z.string(),
  }),
  z.object({
    type:    z.literal('heartbeat'),
    agentId: z.string().uuid(),
    ts:      z.string().datetime(),
  }),
  z.object({
    type:   z.literal('log_line'),
    vmid:   z.number().int().positive(),
    nodeId: z.string().uuid(),
    source: z.enum(LOG_SOURCES),
    unit:   z.string().optional(),
    level:  LogLevelSchema,
    line:   z.string(),
    ts:     z.number().int(),   // unix ms
  }),
])
export type LogAgentClientMessage = z.infer<typeof LogAgentClientMessageSchema>

// control plane → log-agent
export const LogAgentServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth_ok') }),
  z.object({
    type:    z.literal('error'),
    code:    z.string(),
    message: z.string(),
  }),
])
export type LogAgentServerMessage = z.infer<typeof LogAgentServerMessageSchema>

// ── Log query params (REST) ───────────────────────────────────────────────

export const LogQueryParamsSchema = z.object({
  vmid:    z.coerce.number().int().positive().optional(),
  nodeId:  z.string().uuid().optional(),
  source:  z.enum(LOG_SOURCES).optional(),
  level:   LogLevelSchema.optional(),
  unit:    z.string().optional(),
  from:    z.coerce.number().int().optional(),   // unix ms
  to:      z.coerce.number().int().optional(),   // unix ms
  search:  z.string().max(256).optional(),
  cursor:  z.coerce.number().int().optional(),   // last seen id for pagination
  // multi-value filters
  levels:  z.array(LogLevelSchema).optional(),
  sources: z.array(z.enum(LOG_SOURCES)).optional(),
  vmids:   z.array(z.coerce.number().int().positive()).optional(),
  units:   z.array(z.string()).optional(),
  // updated
  limit:      z.coerce.number().int().min(1).max(500).default(100),
  searchMode: z.enum(['text', 'regex']).default('text'),
})
export type LogQueryParams = z.infer<typeof LogQueryParamsSchema>

// ── Log stats ─────────────────────────────────────────────────────────────

export const LogBucketSchema = z.object({
  ts:    z.number(),        // unix ms bucket start
  level: LogLevelSchema,
  count: z.number().int(),
})
export type LogBucket = z.infer<typeof LogBucketSchema>

export const LogStatsResponseSchema = z.object({
  buckets:    z.array(LogBucketSchema),
  totalCount: z.number().int(),
  byLevel:    z.record(z.string(), z.number().int()),
  bySource:   z.record(z.string(), z.number().int()),
})
export type LogStatsResponse = z.infer<typeof LogStatsResponseSchema>

export const LogStatsParamsSchema = z.object({
  vmid:   z.coerce.number().int().positive().optional(),
  vmids:  z.array(z.coerce.number().int().positive()).optional(),
  nodeId: z.string().uuid().optional(),
  levels: z.array(LogLevelSchema).optional(),
  from:   z.coerce.number().int().optional(),
  to:     z.coerce.number().int().optional(),
  bucket: z.enum(['minute', 'hour', 'day']).default('hour'),
})
export type LogStatsParams = z.infer<typeof LogStatsParamsSchema>

// ── Saved log filters ─────────────────────────────────────────────────────

export const SavedLogFilterSchema = z.object({
  id:        z.string().uuid(),
  name:      z.string().min(1).max(100),
  filter:    LogQueryParamsSchema.partial(),
  createdAt: z.string().datetime(),
})
export type SavedLogFilter = z.infer<typeof SavedLogFilterSchema>

export const CreateSavedLogFilterSchema = SavedLogFilterSchema.omit({ id: true, createdAt: true })
export type CreateSavedLogFilter = z.infer<typeof CreateSavedLogFilterSchema>
