import { z } from 'zod'

// ── Success envelope ──────────────────────────────────────────────────────

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema,
  })

// Use the helper at runtime:
// const ResponseSchema = ApiSuccessSchema(UserSchema)
// type Response = z.infer<typeof ResponseSchema>

// ── Error codes ───────────────────────────────────────────────────────────

export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'PROXMOX_ERROR',
  'AGENT_OFFLINE',
  'AGENT_BUSY',
  'DEPLOY_IN_PROGRESS',
  'INTERNAL_ERROR',
  'RATE_LIMITED',
  'WEBHOOK_INVALID_SIGNATURE',
] as const
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES)
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

// ── Error envelope ────────────────────────────────────────────────────────

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  code: ApiErrorCodeSchema,
  message: z.string(),
  details: z.array(
    z.object({
      path: z.array(z.union([z.string(), z.number()])),
      message: z.string(),
    })
  ).optional(),       // populated for VALIDATION_ERROR
})
export type ApiError = z.infer<typeof ApiErrorSchema>

// ── Pagination ────────────────────────────────────────────────────────────

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>

export const PaginatedSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
  })

// ── Audit log entry ───────────────────────────────────────────────────────

export const AUDIT_ACTIONS = [
  'login',
  'logout',
  'password_change',
  'node_create',
  'node_update',
  'node_delete',
  'guest_power',
  'snapshot_create',
  'snapshot_rollback',
  'snapshot_delete',
  'deploy_trigger',
  'deploy_cancel',
  'command_run',
  'command_create',
  'command_delete',
  'target_create',
  'target_update',
  'target_delete',
] as const
export const AuditActionSchema = z.enum(AUDIT_ACTIONS)
export type AuditAction = z.infer<typeof AuditActionSchema>

export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  action: AuditActionSchema,
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  ip: z.string().optional(),
  createdAt: z.string().datetime(),
})
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>
