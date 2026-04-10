import { z } from 'zod'

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('24h'),

  ENCRYPTION_KEY: z.string().length(64),

  AGENT_SECRET: z.string().min(32),
  AGENT_JWT_EXPIRY: z.string().default('7d'),

  GITHUB_WEBHOOK_SECRET: z.string().min(1),

  CORS_ORIGIN: z.string().optional(),

  // Public URL of this control plane — used by agents to reach back home
  CONTROL_PLANE_URL: z.string().url().optional(),

  // Path to the compiled deploy-agent bundle served at GET /api/agents/download
  AGENT_BUNDLE_PATH: z.string().default('./agent-bundle.tar.gz'),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60_000),
})

const parsed = ConfigSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment configuration:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const config = parsed.data
export type Config = typeof config
