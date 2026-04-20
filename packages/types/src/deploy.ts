import { z } from 'zod'

// ── Shared refinements ────────────────────────────────────────────────────

/** Allows alphanumerics and common command characters; blocks shell metacharacters */
export const safeShellCommand = z.string().regex(
  /^[a-zA-Z0-9 _./:@=,+{}\[\]-]+$/,
  'Command contains disallowed shell metacharacters',
)

/** Exactly 40 lowercase hex characters (git SHA-1) */
export const commitShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'Must be a 40-character lowercase hex SHA')

/** Absolute path with no traversal segments */
export const absolutePathSchema = z.string()
  .startsWith('/', 'Must be an absolute path')
  .refine(p => !p.split('/').includes('..'), 'Path must not contain ".." segments')

// ── Trigger sources ───────────────────────────────────────────────────────

export const DeployTriggerSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('github_webhook'),
    repository: z.string(),
    branch: z.string(),
    commitSha: commitShaSchema,
    commitMessage: z.string().optional(),
    actor: z.string().optional(),
    workflowRunId: z.number().optional(),
  }),
  z.object({
    source: z.literal('manual'),
    userId: z.string().uuid(),
    username: z.string(),
  }),
  z.object({
    source: z.literal('cli'),
    userId: z.string().uuid(),
    username: z.string(),
  }),
])
export type DeployTrigger = z.infer<typeof DeployTriggerSchema>

// ── Job states ────────────────────────────────────────────────────────────

export const DEPLOY_STATES = [
  'queued',
  'dispatched',
  'running',
  'success',
  'failed',
  'cancelled',
] as const
export const DeployStateSchema = z.enum(DEPLOY_STATES)
export type DeployState = z.infer<typeof DeployStateSchema>

// Terminal states — job will not transition out of these
export const DEPLOY_TERMINAL_STATES = ['success', 'failed', 'cancelled'] as const
export const DeployTerminalStateSchema = z.enum(DEPLOY_TERMINAL_STATES)
export type DeployTerminalState = z.infer<typeof DeployTerminalStateSchema>

// ── Deploy target ─────────────────────────────────────────────────────────
// Maps a repository + branch to a specific container

export const DeployTargetSchema = z.object({
  id: z.string().uuid(),
  repository: z.string(),          // e.g. NinjaGoldfinch/ninja-skyblock-api
  branch: z.string(),              // e.g. main
  nodeId: z.string().uuid(),
  vmid: z.number().int().positive(),
  workingDir: absolutePathSchema,  // absolute path inside container
  restartCommand: safeShellCommand,          // e.g. "systemctl restart skyblock-api"
  preDeployCommand: safeShellCommand.optional(),   // run before pull
  postDeployCommand: safeShellCommand.optional(),  // run after restart
  timeoutSeconds: z.number().int().positive().default(300),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type DeployTarget = z.infer<typeof DeployTargetSchema>

// ── Deploy job ────────────────────────────────────────────────────────────

export const DeployJobSchema = z.object({
  id: z.string().uuid(),
  targetId: z.string().uuid(),
  target: DeployTargetSchema.optional(),   // populated in API responses
  trigger: DeployTriggerSchema,
  state: DeployStateSchema,
  agentId: z.string().uuid().nullable(),   // which agent picked it up
  queuedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  exitCode: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
})
export type DeployJob = z.infer<typeof DeployJobSchema>

// ── Log line emitted during a deploy ─────────────────────────────────────

export const DeployLogLineSchema = z.object({
  jobId: z.string().uuid(),
  seq: z.number().int().nonnegative(),     // monotonic sequence within the job
  timestamp: z.string().datetime(),
  stream: z.enum(['stdout', 'stderr']),
  line: z.string(),
})
export type DeployLogLine = z.infer<typeof DeployLogLineSchema>

// ── GitHub webhook payload (subset we care about) ─────────────────────────

export const GithubWorkflowRunPayloadSchema = z.object({
  action: z.enum(['completed', 'requested', 'in_progress']),
  workflow_run: z.object({
    id: z.number(),
    name: z.string(),
    head_branch: z.string(),
    head_sha: z.string(),
    conclusion: z.enum(['success', 'failure', 'cancelled', 'skipped', 'timed_out']).nullable(),
    html_url: z.string().url(),
    repository: z.object({
      full_name: z.string(),
    }),
    triggering_actor: z.object({
      login: z.string(),
    }),
  }),
})
export type GithubWorkflowRunPayload = z.infer<typeof GithubWorkflowRunPayloadSchema>
