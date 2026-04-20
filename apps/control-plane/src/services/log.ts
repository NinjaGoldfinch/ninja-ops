import { Writable } from 'node:stream'
import { sql } from '../db/client.js'
import { sessionManager } from '../ws/session.js'
import { AppError } from '../errors.js'
import type { LogAgentClientMessage, LogQueryParams, LogEntryRow, LogStatsParams, LogStatsResponse } from '@ninja/types'

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

const EXPORT_ROW_CAP = 50_000
const EXPORT_BATCH_SIZE = 1_000

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
    const limit = params.limit ?? 100

    if (params.searchMode === 'regex' && params.search) {
      try { new RegExp(params.search) } catch {
        throw AppError.regexInvalid(`Invalid regular expression: ${params.search}`)
      }
    }

    const conditions: ReturnType<typeof sql>[] = []

    if (params.vmid !== undefined)   conditions.push(sql`vmid    = ${params.vmid}`)
    if (params.nodeId !== undefined) conditions.push(sql`node_id = ${params.nodeId}`)
    if (params.source !== undefined) conditions.push(sql`source  = ${params.source}`)
    if (params.level !== undefined)  conditions.push(sql`level   = ${params.level}`)
    if (params.unit !== undefined)   conditions.push(sql`unit    = ${params.unit}`)
    if (params.from !== undefined)   conditions.push(sql`ts     >= ${params.from}`)
    if (params.to !== undefined)     conditions.push(sql`ts     <= ${params.to}`)
    if (params.cursor !== undefined) conditions.push(sql`id      < ${params.cursor}`)

    // Multi-value filters
    if (params.levels?.length)  conditions.push(sql`level  = ANY(${params.levels})`)
    if (params.sources?.length) conditions.push(sql`source = ANY(${params.sources})`)
    if (params.vmids?.length)   conditions.push(sql`vmid   = ANY(${params.vmids})`)
    if (params.units?.length)   conditions.push(sql`unit   = ANY(${params.units})`)

    // Search
    if (params.search) {
      if (params.searchMode === 'regex') {
        conditions.push(sql`line ~* ${params.search}`)
      } else {
        conditions.push(sql`to_tsvector('simple', line) @@ plainto_tsquery('simple', ${params.search})`)
      }
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

  async getStats(params: LogStatsParams): Promise<LogStatsResponse> {
    const conditions: ReturnType<typeof sql>[] = []

    if (params.vmid !== undefined)  conditions.push(sql`vmid    = ${params.vmid}`)
    if (params.nodeId !== undefined) conditions.push(sql`node_id = ${params.nodeId}`)
    if (params.vmids?.length)       conditions.push(sql`vmid    = ANY(${params.vmids})`)
    if (params.levels?.length)      conditions.push(sql`level   = ANY(${params.levels})`)
    if (params.from !== undefined)  conditions.push(sql`ts     >= ${params.from}`)
    if (params.to !== undefined)    conditions.push(sql`ts     <= ${params.to}`)

    const where = conditions.length > 0
      ? sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : sql``

    // Map bucket size to postgres date_trunc field
    const truncField = params.bucket === 'minute' ? 'minute' : params.bucket === 'day' ? 'day' : 'hour'

    // Bucket counts by level
    interface BucketRow { bucket_ts: string; level: string; cnt: string }
    const bucketRows = await sql<BucketRow[]>`
      SELECT
        date_trunc(${truncField}, to_timestamp(ts / 1000.0) AT TIME ZONE 'UTC') AS bucket_ts,
        level,
        COUNT(*)::text AS cnt
      FROM log_entries
      ${where}
      GROUP BY bucket_ts, level
      ORDER BY bucket_ts ASC
    `

    const buckets = bucketRows.map((r) => ({
      ts:    new Date(r.bucket_ts).getTime(),
      level: r.level as LogEntryRow['level'],
      count: Number(r.cnt),
    }))

    // Totals by level and source
    interface CountRow { key: string; cnt: string }
    const levelCounts = await sql<CountRow[]>`
      SELECT level AS key, COUNT(*)::text AS cnt FROM log_entries ${where} GROUP BY level
    `
    const sourceCounts = await sql<CountRow[]>`
      SELECT source AS key, COUNT(*)::text AS cnt FROM log_entries ${where} GROUP BY source
    `

    const totalCount = levelCounts.reduce((sum, r) => sum + Number(r.cnt), 0)
    const byLevel = Object.fromEntries(levelCounts.map((r) => [r.key, Number(r.cnt)]))
    const bySource = Object.fromEntries(sourceCounts.map((r) => [r.key, Number(r.cnt)]))

    return { buckets, totalCount, byLevel, bySource }
  }

  async exportStream(
    params: LogQueryParams & { format: 'ndjson' | 'csv' },
    writable: Writable,
  ): Promise<void> {
    // Check row count first
    const conditions: ReturnType<typeof sql>[] = []
    if (params.vmid !== undefined)   conditions.push(sql`vmid    = ${params.vmid}`)
    if (params.nodeId !== undefined) conditions.push(sql`node_id = ${params.nodeId}`)
    if (params.source !== undefined) conditions.push(sql`source  = ${params.source}`)
    if (params.level !== undefined)  conditions.push(sql`level   = ${params.level}`)
    if (params.unit !== undefined)   conditions.push(sql`unit    = ${params.unit}`)
    if (params.from !== undefined)   conditions.push(sql`ts     >= ${params.from}`)
    if (params.to !== undefined)     conditions.push(sql`ts     <= ${params.to}`)
    if (params.levels?.length)       conditions.push(sql`level  = ANY(${params.levels})`)
    if (params.sources?.length)      conditions.push(sql`source = ANY(${params.sources})`)
    if (params.vmids?.length)        conditions.push(sql`vmid   = ANY(${params.vmids})`)
    if (params.units?.length)        conditions.push(sql`unit   = ANY(${params.units})`)
    if (params.search) {
      if (params.searchMode === 'regex') {
        conditions.push(sql`line ~* ${params.search}`)
      } else {
        conditions.push(sql`to_tsvector('simple', line) @@ plainto_tsquery('simple', ${params.search})`)
      }
    }

    const where = conditions.length > 0
      ? sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : sql``

    const [countRow] = await sql<[{ cnt: string }]>`
      SELECT COUNT(*)::text AS cnt FROM log_entries ${where}
    `
    const total = Number(countRow?.cnt ?? 0)
    if (total > EXPORT_ROW_CAP) {
      throw AppError.exportTooLarge(`Export would return ${total} rows; maximum is ${EXPORT_ROW_CAP}`)
    }

    if (params.format === 'csv') {
      writable.write('id,ts,vmid,node_id,source,unit,level,line\n')
    }

    // Stream in batches
    let cursor: number | undefined
    let fetched = 0

    while (fetched < total) {
      const batchConditions = [...conditions]
      if (cursor !== undefined) batchConditions.push(sql`id < ${cursor}`)

      const batchWhere = batchConditions.length > 0
        ? sql`WHERE ${batchConditions.reduce((a, b) => sql`${a} AND ${b}`)}`
        : sql``

      const rows = await sql<DbLogEntry[]>`
        SELECT id, vmid, node_id, source, unit, level, line, ts
        FROM   log_entries
        ${batchWhere}
        ORDER  BY ts DESC, id DESC
        LIMIT  ${EXPORT_BATCH_SIZE}
      `

      if (rows.length === 0) break

      for (const r of rows) {
        if (params.format === 'ndjson') {
          writable.write(JSON.stringify({
            id: Number(r.id), ts: Number(r.ts), vmid: r.vmid,
            nodeId: r.node_id, source: r.source, unit: r.unit,
            level: r.level, line: r.line,
          }) + '\n')
        } else {
          const escapeCsv = (v: string | null) =>
            v === null ? '' : `"${v.replace(/"/g, '""')}"`
          writable.write(
            [Number(r.id), Number(r.ts), r.vmid, r.node_id,
              r.source, escapeCsv(r.unit), r.level, escapeCsv(r.line)].join(',') + '\n'
          )
        }
      }

      cursor = Number(rows[rows.length - 1]!.id)
      fetched += rows.length
    }

    writable.end()
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
