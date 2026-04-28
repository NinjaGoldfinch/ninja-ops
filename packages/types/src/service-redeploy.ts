import { z } from 'zod'

export const SERVICE_NAMES = ['control-plane', 'dashboard'] as const
export const ServiceNameSchema = z.enum(SERVICE_NAMES)
export type ServiceName = z.infer<typeof ServiceNameSchema>

export const SERVICE_REDEPLOY_STATES = ['queued', 'running', 'success', 'failed', 'cancelled'] as const
export const ServiceRedeployStateSchema = z.enum(SERVICE_REDEPLOY_STATES)
export type ServiceRedeployState = z.infer<typeof ServiceRedeployStateSchema>

export const ServiceVersionSchema = z.object({
  service:          ServiceNameSchema,
  current:          z.string(),
  latest:           z.string(),
  latestSha:        z.string(),
  updateAvailable:  z.boolean(),
  checkedAt:        z.string().datetime(),
})
export type ServiceVersion = z.infer<typeof ServiceVersionSchema>

export const ServiceRedeployJobSchema = z.object({
  id:            z.string().uuid(),
  service:       ServiceNameSchema,
  state:         ServiceRedeployStateSchema,
  targetVersion: z.string().optional(),
  errorMessage:  z.string().nullable(),
  queuedAt:      z.string().datetime(),
  startedAt:     z.string().datetime().nullable(),
  finishedAt:    z.string().datetime().nullable(),
})
export type ServiceRedeployJob = z.infer<typeof ServiceRedeployJobSchema>

export const EnqueueServiceRedeploySchema = z.object({
  service:       ServiceNameSchema,
  targetVersion: z.string().optional(),
})
export type EnqueueServiceRedeploy = z.infer<typeof EnqueueServiceRedeploySchema>
