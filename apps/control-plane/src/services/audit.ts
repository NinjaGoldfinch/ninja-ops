import { sql } from '../db/client.js'
import { childLogger } from '../lib/logger.js'
import type { AuditAction, AuditLogEntry, PaginationQuery } from '@ninja/types'

const log = childLogger('audit')

interface LogParams {
  userId?: string | null
  username?: string | null
  action: AuditAction
  resourceType?: string
  resourceId?: string
  meta?: Record<string, unknown>
  ip?: string
}

interface DbAuditRow {
  id: string
  user_id: string | null
  username: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  meta: Record<string, unknown> | null
  ip: string | null
  created_at: Date
}

function toEntry(row: DbAuditRow): AuditLogEntry {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    action: row.action as AuditAction,
    ...(row.resource_type != null ? { resourceType: row.resource_type } : {}),
    ...(row.resource_id != null ? { resourceId: row.resource_id } : {}),
    ...(row.meta != null ? { meta: row.meta } : {}),
    ...(row.ip != null ? { ip: row.ip } : {}),
    createdAt: row.created_at.toISOString(),
  }
}

export class AuditService {
  log(params: LogParams): void {
    // Fire-and-forget: never awaited, never blocks the caller
    const { userId, username, action, resourceType, resourceId, meta, ip } = params
    sql`
      INSERT INTO audit_log (user_id, username, action, resource_type, resource_id, meta, ip)
      VALUES (
        ${userId ?? null},
        ${username ?? null},
        ${action},
        ${resourceType ?? null},
        ${resourceId ?? null},
        ${meta ? sql.json(meta as Parameters<typeof sql.json>[0]) : null},
        ${ip ?? null}
      )
    `.catch((err: Error) => {
      log.error({ err, action }, 'Failed to write audit log entry')
    })
  }

  async list(opts: PaginationQuery): Promise<{ items: AuditLogEntry[]; total: number }> {
    const offset = (opts.page - 1) * opts.limit

    const [rows, countRows] = await Promise.all([
      sql<DbAuditRow[]>`
        SELECT id, user_id, username, action, resource_type, resource_id, meta, ip, created_at
        FROM audit_log
        ORDER BY created_at DESC
        LIMIT ${opts.limit} OFFSET ${offset}
      `,
      sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM audit_log`,
    ])

    const total = parseInt(countRows[0]?.count ?? '0', 10)
    return { items: rows.map(toEntry), total }
  }
}

export const auditService = new AuditService()
