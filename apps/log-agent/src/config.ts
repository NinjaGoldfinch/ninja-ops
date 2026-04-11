import { z } from 'zod'
import os from 'node:os'

const ConfigSchema = z.object({
  NODE_ID:               z.string().uuid(),
  VMID:                  z.coerce.number().int().positive(),
  CONTROL_PLANE_URL:     z.string().url(),
  AGENT_SECRET:          z.string().min(32),
  HOSTNAME:              z.string().default(os.hostname()),
  LOG_UNITS:             z.string().default(''),
  LOG_SYSTEM:            z.coerce.boolean().default(false),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  RECONNECT_DELAY_MS:    z.coerce.number().int().positive().default(5_000),
  LOG_LEVEL:             z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
})

export type Config = z.infer<typeof ConfigSchema>

const parsed = ConfigSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment configuration:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const config = parsed.data
