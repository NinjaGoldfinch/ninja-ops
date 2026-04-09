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
