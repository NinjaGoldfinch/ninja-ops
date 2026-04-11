import { randomUUID } from 'node:crypto'
import { sql } from '../db/client.js'

export class JobLogger {
  readonly sessionId: string
  private readonly pendingWrites: Promise<unknown>[] = []

  constructor(
    private readonly jobType: string,
    private readonly jobId: string,
    sessionId?: string,
  ) {
    this.sessionId = sessionId ?? randomUUID()
  }

  write(stream: 'stdout' | 'stderr', data: string): void {
    // Pass through to real stdout/stderr (captured by log interceptor for live tail)
    if (stream === 'stdout') process.stdout.write(data)
    else process.stderr.write(data)

    // Persist — track the promise so flush() can await all writes
    const p = sql`
      INSERT INTO job_logs (session_id, job_type, job_id, stream, data, ts)
      VALUES (${this.sessionId}, ${this.jobType}, ${this.jobId}, ${stream}, ${data}, ${Date.now()})
    `.catch((err: unknown) => {
      process.stderr.write(`[job-logger] failed to persist log: ${String(err)}\n`)
    })
    this.pendingWrites.push(p)
  }

  /** Wait for all in-flight DB writes to complete before the caller responds. */
  async flush(): Promise<void> {
    await Promise.all(this.pendingWrites)
    this.pendingWrites.length = 0
  }

  info(msg: string): void {
    this.write('stdout', msg.endsWith('\n') ? msg : msg + '\n')
  }

  error(msg: string): void {
    this.write('stderr', msg.endsWith('\n') ? msg : msg + '\n')
  }
}

export interface StoredLogEntry {
  id: string
  sessionId: string
  jobType: string
  jobId: string
  stream: 'stdout' | 'stderr'
  data: string
  ts: number
  createdAt: string
}

interface DbLogEntry {
  id: string
  session_id: string
  job_type: string
  job_id: string
  stream: string
  data: string
  ts: string
  created_at: Date
}

function toEntry(row: DbLogEntry): StoredLogEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    jobType: row.job_type,
    jobId: row.job_id,
    stream: row.stream as 'stdout' | 'stderr',
    data: row.data,
    ts: Number(row.ts),
    createdAt: row.created_at.toISOString(),
  }
}

export async function getSessionLogs(sessionId: string): Promise<StoredLogEntry[]> {
  const rows = await sql<DbLogEntry[]>`
    SELECT * FROM job_logs WHERE session_id = ${sessionId} ORDER BY created_at, id
  `
  return rows.map(toEntry)
}

export async function getJobSessions(jobType: string, jobId: string): Promise<{ sessionId: string; createdAt: string }[]> {
  const rows = await sql<{ session_id: string; created_at: Date }[]>`
    SELECT DISTINCT session_id, MIN(created_at) AS created_at
    FROM job_logs
    WHERE job_type = ${jobType} AND job_id = ${jobId}
    GROUP BY session_id
    ORDER BY MIN(created_at) DESC
    LIMIT 20
  `
  return rows.map(r => ({ sessionId: r.session_id, createdAt: r.created_at.toISOString() }))
}
