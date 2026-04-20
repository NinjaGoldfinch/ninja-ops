import { existsSync } from 'fs'
import { initLogInterceptor } from './lib/log-interceptor.js'
import { buildApp } from './app.js'

initLogInterceptor()
import { config } from './config.js'
import { childLogger } from './lib/logger.js'

const log = childLogger('startup')
import { connectRedis, closeRedis } from './db/redis.js'
import { closeDb } from './db/client.js'
import { startWorkers, stopWorkers } from './workers/metrics-poller.js'
import { startDeployWorker, stopDeployWorker } from './workers/deploy-runner.js'
import { startProvisioningWorker, stopProvisioningWorker } from './workers/provisioning-runner.js'
import { startLogPurgeWorker, stopLogPurgeWorker } from './workers/log-purge.js'

// Warn early if agent bundles are missing — deployments will fail at the download step
if (!existsSync(config.AGENT_BUNDLE_PATH)) {
  log.warn(
    { path: config.AGENT_BUNDLE_PATH },
    'Agent bundle not found — run `pnpm package:agent` to build it',
  )
}
if (!existsSync(config.LOG_AGENT_BUNDLE_PATH)) {
  log.warn(
    { path: config.LOG_AGENT_BUNDLE_PATH },
    'Log-agent bundle not found — run `pnpm package:log-agent` to build it',
  )
}

await connectRedis()
await startWorkers()
await startDeployWorker()
await startProvisioningWorker()
await startLogPurgeWorker()

const app = await buildApp()

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down...`)
  await app.close()
  await stopWorkers()
  await stopDeployWorker()
  await stopProvisioningWorker()
  await stopLogPurgeWorker()
  await closeRedis()
  await closeDb()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await app.listen({ port: config.PORT, host: config.HOST })
