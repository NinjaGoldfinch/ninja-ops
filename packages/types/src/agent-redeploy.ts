import { z } from 'zod'
import { AgentKindSchema } from './agent.js'

// ── State ─────────────────────────────────────────────────────────────────

export const AGENT_REDEPLOY_STATES = [
  'queued',
  'running',
  'success',
  'failed',
  'cancelled',
] as const

export const AgentRedeployStateSchema = z.enum(AGENT_REDEPLOY_STATES)
export type AgentRedeployState = z.infer<typeof AgentRedeployStateSchema>

// ── Job ───────────────────────────────────────────────────────────────────

export const AgentRedeployJobSchema = z.object({
  id:           z.string().uuid(),
  agentId:      z.string().uuid(),
  state:        AgentRedeployStateSchema,
  errorMessage: z.string().nullable(),
  queuedAt:     z.string().datetime(),
  startedAt:    z.string().datetime().nullable(),
  finishedAt:   z.string().datetime().nullable(),
})
export type AgentRedeployJob = z.infer<typeof AgentRedeployJobSchema>

// ── Request bodies ────────────────────────────────────────────────────────

export const EnqueueAllRequestSchema = z.object({
  kind:         AgentKindSchema.optional(),
  onlyOutdated: z.boolean().optional(),
})
export type EnqueueAllRequest = z.infer<typeof EnqueueAllRequestSchema>

// ── Bundle info ───────────────────────────────────────────────────────────

export const BundleInfoSchema = z.object({
  deployAgentHash: z.string(),
  logAgentHash:    z.string(),
})
export type BundleInfo = z.infer<typeof BundleInfoSchema>
