import { z } from 'zod'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Resolve paths relative to this package root, not the process CWD
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

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
  AGENT_BUNDLE_PATH: z.string().default(resolve(packageRoot, 'agent-bundle.tar.gz')),

  // Path to the compiled log-agent bundle served at GET /api/log-agents/download
  LOG_AGENT_BUNDLE_PATH: z.string().default(resolve(packageRoot, 'log-agent-bundle.tar.gz')),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60_000),

  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // 1Password service account token — required only when op:// secret references are used
  // for SSH private keys. Get one at: https://developer.1password.com/docs/service-accounts/
  OP_SERVICE_ACCOUNT_TOKEN: z.string().optional(),

  // Self-redeployment: SSH host + key for the machine running control-plane and dashboard
  SELF_DEPLOY_HOST: z.string().optional(),
  SELF_DEPLOY_SSH_KEY: z.string().optional(),
  SERVICE_CONTROL_PLANE_UNIT: z.string().default('ninja-control-plane'),
  SERVICE_DASHBOARD_UNIT: z.string().default('nginx'),
  SERVICE_CONTROL_PLANE_DIR: z.string().default('/opt/ninja-ops'),
  SERVICE_DASHBOARD_DIR: z.string().default('/opt/ninja-ops'),

  // GitHub repo for version polling (e.g. "NinjaGoldfinch/ninja-ops")
  GITHUB_REPO: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  SERVICE_VERSION_POLL_INTERVAL_MS: z.coerce.number().default(30 * 60 * 1000),
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
