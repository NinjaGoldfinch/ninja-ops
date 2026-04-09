import { sql } from '../db/client.js'
import { AppError } from '../errors.js'
import type {
  DeployTarget,
  DeployJob,
  DeployLogLine,
  DeployTrigger,
  DeployState,
} from '@ninja/types'

// ── Type helpers ─────────────────────────────────────────────────────────────

interface DbTarget {
  id: string
  repository: string
  branch: string
  node_id: string
  vmid: number
  working_dir: string
  restart_command: string
  pre_deploy_command: string | null
  post_deploy_command: string | null
  timeout_seconds: number
  created_at: Date
  updated_at: Date
}

interface DbJob {
  id: string
  target_id: string
  trigger: DeployTrigger
  state: string
  agent_id: string | null
  queued_at: Date
  started_at: Date | null
  finished_at: Date | null
  exit_code: number | null
  error_message: string | null
}

interface DbLogLine {
  job_id: string
  seq: number
  timestamp: Date
  stream: 'stdout' | 'stderr'
  line: string
}

function toTarget(row: DbTarget): DeployTarget {
  return {
    id: row.id,
    repository: row.repository,
    branch: row.branch,
    nodeId: row.node_id,
    vmid: row.vmid,
    workingDir: row.working_dir,
    restartCommand: row.restart_command,
    ...(row.pre_deploy_command != null ? { preDeployCommand: row.pre_deploy_command } : {}),
    ...(row.post_deploy_command != null ? { postDeployCommand: row.post_deploy_command } : {}),
    timeoutSeconds: row.timeout_seconds,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toJob(row: DbJob): DeployJob {
  return {
    id: row.id,
    targetId: row.target_id,
    trigger: row.trigger,
    state: row.state as DeployState,
    agentId: row.agent_id,
    queuedAt: row.queued_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    exitCode: row.exit_code,
    errorMessage: row.error_message,
  }
}

function toLogLine(row: DbLogLine): DeployLogLine {
  return {
    jobId: row.job_id,
    seq: row.seq,
    timestamp: row.timestamp.toISOString(),
    stream: row.stream,
    line: row.line,
  }
}

// ── CreateTargetParams ────────────────────────────────────────────────────────

interface CreateTargetParams {
  repository: string
  branch: string
  nodeId: string
  vmid: number
  workingDir: string
  restartCommand: string
  preDeployCommand?: string | undefined
  postDeployCommand?: string | undefined
  timeoutSeconds?: number | undefined
}

interface UpdateTargetParams {
  repository?: string | undefined
  branch?: string | undefined
  nodeId?: string | undefined
  vmid?: number | undefined
  workingDir?: string | undefined
  restartCommand?: string | undefined
  preDeployCommand?: string | undefined
  postDeployCommand?: string | undefined
  timeoutSeconds?: number | undefined
}

// ── Service ───────────────────────────────────────────────────────────────────

export class DeployService {
  // ── Targets ────────────────────────────────────────────────────────────────

  async listTargets(): Promise<DeployTarget[]> {
    const rows = await sql<DbTarget[]>`
      SELECT id, repository, branch, node_id, vmid, working_dir, restart_command,
             pre_deploy_command, post_deploy_command, timeout_seconds, created_at, updated_at
      FROM deploy_targets
      ORDER BY created_at ASC
    `
    return rows.map(toTarget)
  }

  async getTarget(id: string): Promise<DeployTarget> {
    const rows = await sql<DbTarget[]>`
      SELECT id, repository, branch, node_id, vmid, working_dir, restart_command,
             pre_deploy_command, post_deploy_command, timeout_seconds, created_at, updated_at
      FROM deploy_targets WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Deploy target')
    return toTarget(row)
  }

  async findTargetByRepoBranch(
    repository: string,
    branch: string,
  ): Promise<DeployTarget | null> {
    const rows = await sql<DbTarget[]>`
      SELECT id, repository, branch, node_id, vmid, working_dir, restart_command,
             pre_deploy_command, post_deploy_command, timeout_seconds, created_at, updated_at
      FROM deploy_targets
      WHERE repository = ${repository} AND branch = ${branch}
    `
    const row = rows[0]
    return row ? toTarget(row) : null
  }

  async createTarget(params: CreateTargetParams): Promise<DeployTarget> {
    const rows = await sql<DbTarget[]>`
      INSERT INTO deploy_targets (
        repository, branch, node_id, vmid, working_dir, restart_command,
        pre_deploy_command, post_deploy_command, timeout_seconds
      ) VALUES (
        ${params.repository}, ${params.branch}, ${params.nodeId}, ${params.vmid},
        ${params.workingDir}, ${params.restartCommand},
        ${params.preDeployCommand ?? null}, ${params.postDeployCommand ?? null},
        ${params.timeoutSeconds ?? 300}
      )
      RETURNING id, repository, branch, node_id, vmid, working_dir, restart_command,
                pre_deploy_command, post_deploy_command, timeout_seconds, created_at, updated_at
    `
    const row = rows[0]
    if (!row) throw AppError.internal('Failed to create deploy target')
    return toTarget(row)
  }

  async updateTarget(id: string, params: UpdateTargetParams): Promise<DeployTarget> {
    const existing = await this.getTarget(id)

    const rows = await sql<DbTarget[]>`
      UPDATE deploy_targets SET
        repository          = ${params.repository ?? existing.repository},
        branch              = ${params.branch ?? existing.branch},
        node_id             = ${params.nodeId ?? existing.nodeId},
        vmid                = ${params.vmid ?? existing.vmid},
        working_dir         = ${params.workingDir ?? existing.workingDir},
        restart_command     = ${params.restartCommand ?? existing.restartCommand},
        pre_deploy_command  = ${params.preDeployCommand ?? existing.preDeployCommand ?? null},
        post_deploy_command = ${params.postDeployCommand ?? existing.postDeployCommand ?? null},
        timeout_seconds     = ${params.timeoutSeconds ?? existing.timeoutSeconds},
        updated_at          = now()
      WHERE id = ${id}
      RETURNING id, repository, branch, node_id, vmid, working_dir, restart_command,
                pre_deploy_command, post_deploy_command, timeout_seconds, created_at, updated_at
    `
    const row = rows[0]
    if (!row) throw AppError.internal('Failed to update deploy target')
    return toTarget(row)
  }

  async deleteTarget(id: string): Promise<void> {
    const result = await sql`DELETE FROM deploy_targets WHERE id = ${id}`
    if (result.count === 0) throw AppError.notFound('Deploy target')
  }

  // ── Jobs ───────────────────────────────────────────────────────────────────

  async listJobs(opts?: {
    targetId?: string | undefined
    state?: DeployState | undefined
    limit?: number | undefined
  }): Promise<DeployJob[]> {
    const limit = opts?.limit ?? 50
    const targetId = opts?.targetId
    const state = opts?.state

    let rows: DbJob[]
    if (targetId !== undefined && state !== undefined) {
      rows = await sql<DbJob[]>`
        SELECT id, target_id, trigger, state, agent_id, queued_at,
               started_at, finished_at, exit_code, error_message
        FROM deploy_jobs
        WHERE target_id = ${targetId} AND state = ${state}
        ORDER BY queued_at DESC LIMIT ${limit}
      `
    } else if (targetId !== undefined) {
      rows = await sql<DbJob[]>`
        SELECT id, target_id, trigger, state, agent_id, queued_at,
               started_at, finished_at, exit_code, error_message
        FROM deploy_jobs
        WHERE target_id = ${targetId}
        ORDER BY queued_at DESC LIMIT ${limit}
      `
    } else if (state !== undefined) {
      rows = await sql<DbJob[]>`
        SELECT id, target_id, trigger, state, agent_id, queued_at,
               started_at, finished_at, exit_code, error_message
        FROM deploy_jobs
        WHERE state = ${state}
        ORDER BY queued_at DESC LIMIT ${limit}
      `
    } else {
      rows = await sql<DbJob[]>`
        SELECT id, target_id, trigger, state, agent_id, queued_at,
               started_at, finished_at, exit_code, error_message
        FROM deploy_jobs
        ORDER BY queued_at DESC LIMIT ${limit}
      `
    }

    return rows.map(toJob)
  }

  async getJob(id: string): Promise<DeployJob> {
    const rows = await sql<DbJob[]>`
      SELECT id, target_id, trigger, state, agent_id, queued_at,
             started_at, finished_at, exit_code, error_message
      FROM deploy_jobs WHERE id = ${id}
    `
    const row = rows[0]
    if (!row) throw AppError.notFound('Deploy job')
    return toJob(row)
  }

  async getJobLogs(jobId: string): Promise<DeployLogLine[]> {
    const rows = await sql<DbLogLine[]>`
      SELECT job_id, seq, timestamp, stream, line
      FROM deploy_log_lines
      WHERE job_id = ${jobId}
      ORDER BY seq ASC
    `
    return rows.map(toLogLine)
  }

  async triggerDeploy(targetId: string, trigger: DeployTrigger): Promise<DeployJob> {
    // Check for active deploy on this target
    const active = await sql<{ id: string }[]>`
      SELECT id FROM deploy_jobs
      WHERE target_id = ${targetId}
        AND state IN ('queued', 'dispatched', 'running')
      LIMIT 1
    `
    if (active.length > 0) {
      throw AppError.deployInProgress(targetId)
    }

    const rows = await sql<DbJob[]>`
      INSERT INTO deploy_jobs (target_id, trigger, state)
      VALUES (${targetId}, ${sql.json(trigger as unknown as Parameters<typeof sql.json>[0])}, 'queued')
      RETURNING id, target_id, trigger, state, agent_id, queued_at,
                started_at, finished_at, exit_code, error_message
    `
    const row = rows[0]
    if (!row) throw AppError.internal('Failed to create deploy job')
    return toJob(row)
  }

  async transitionState(
    jobId: string,
    state: DeployState,
    meta?: { exitCode?: number | undefined; errorMessage?: string | undefined; agentId?: string | undefined },
  ): Promise<void> {
    const updates: Record<string, unknown> = { state }
    if (state === 'running') updates['started_at'] = new Date()
    if (['success', 'failed', 'cancelled'].includes(state)) {
      updates['finished_at'] = new Date()
    }
    if (meta?.exitCode !== undefined) updates['exit_code'] = meta.exitCode
    if (meta?.errorMessage !== undefined) updates['error_message'] = meta.errorMessage
    if (meta?.agentId !== undefined) updates['agent_id'] = meta.agentId

    await sql`
      UPDATE deploy_jobs SET
        state         = ${state},
        started_at    = COALESCE(${updates['started_at'] as Date | null ?? null}, started_at),
        finished_at   = COALESCE(${updates['finished_at'] as Date | null ?? null}, finished_at),
        exit_code     = COALESCE(${updates['exit_code'] as number | null ?? null}, exit_code),
        error_message = COALESCE(${updates['error_message'] as string | null ?? null}, error_message),
        agent_id      = COALESCE(${updates['agent_id'] as string | null ?? null}, agent_id)
      WHERE id = ${jobId}
    `
  }

  async appendLogLine(line: Omit<DeployLogLine, 'timestamp'>): Promise<void> {
    await sql`
      INSERT INTO deploy_log_lines (job_id, seq, stream, line)
      VALUES (${line.jobId}, ${line.seq}, ${line.stream}, ${line.line})
    `
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId)
    if (['success', 'failed', 'cancelled'].includes(job.state)) {
      throw AppError.conflict(`Job is already in terminal state: ${job.state}`)
    }
    await this.transitionState(jobId, 'cancelled')
  }
}

export const deployService = new DeployService()
