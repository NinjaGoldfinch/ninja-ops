import { sql } from '../db/client.js'
import { sessionManager } from '../ws/session.js'
import type { LogAgentClientMessage, LogQueryParams, LogEntryRow } from '@ninja/types'

interface DbLogEntry {
  id: string          // bigserial comes back as string from postgres.js
  vmid: number
  node_id: string
  source: string
  unit: string | null
  level: string
  line: string
  ts: string          // bigint comes back as string
}

function toRow(r: DbLogEntry): LogEntryRow {
  return {
    id:     Number(r.id),
    vmid:   r.vmid,
    nodeId: r.node_id,
    source: r.source as LogEntryRow['source'],
    unit:   r.unit,
    level:  r.level as LogEntryRow['level'],
    line:   r.line,
    ts:     Number(r.ts),
  }
}

export class LogService {
  ingest(msg: Extract<LogAgentClientMessage, { type: 'log_line' }>): void {
    // Fire-and-forget persist
    sql`
      INSERT INTO log_entries (vmid, node_id, source, unit, level, line, ts)
      VALUES (
        ${msg.vmid}, ${msg.nodeId}, ${msg.source},
        ${msg.unit ?? null}, ${msg.level}, ${msg.line}, ${msg.ts}
      )
    `.catch((err: Error) => {
      console.error('[log-service] Failed to persist log entry:', err.message)
    })

    // Broadcast to subscribed dashboard clients
    sessionManager.broadcastLogLine({
      id:     0,
      vmid:   msg.vmid,
      nodeId: msg.nodeId,
      source: msg.source,
      unit:   msg.unit ?? null,
      level:  msg.level,
      line:   msg.line,
      ts:     msg.ts,
    })
  }

  async query(params: LogQueryParams): Promise<{ rows: LogEntryRow[]; nextCursor: number | null }> {
    const limit = params.limit ?? 200
    const conditions: ReturnType<typeof sql>[] = []

    if (params.vmid !== undefined)   conditions.push(sql`vmid    = ${params.vmid}`)
    if (params.nodeId !== undefined) conditions.push(sql`node_id = ${params.nodeId}`)
    if (params.source !== undefined) conditions.push(sql`source  = ${params.source}`)
    if (params.level !== undefined)  conditions.push(sql`level   = ${params.level}`)
    if (params.unit !== undefined)   conditions.push(sql`unit    = ${params.unit}`)
    if (params.from !== undefined)   conditions.push(sql`ts     >= ${params.from}`)
    if (params.to !== undefined)     conditions.push(sql`ts     <= ${params.to}`)
    if (params.cursor !== undefined) conditions.push(sql`id      < ${params.cursor}`)
    if (params.search !== undefined) {
      conditions.push(sql`line ILIKE ${'%' + params.search.replace(/[%_]/g, '\\$&') + '%'}`)
    }

    const where = conditions.length > 0
      ? sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : sql``

    const rows = await sql<DbLogEntry[]>`
      SELECT id, vmid, node_id, source, unit, level, line, ts
      FROM   log_entries
      ${where}
      ORDER  BY ts DESC, id DESC
      LIMIT  ${limit + 1}
    `

    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).map(toRow)
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

    return { rows: page, nextCursor }
  }

  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000)
    const result = await sql`
      DELETE FROM log_entries WHERE created_at < ${cutoff}
    `
    return result.count
  }
}

export const logService = new LogService()
