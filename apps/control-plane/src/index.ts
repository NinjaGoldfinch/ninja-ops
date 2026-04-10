import { existsSync } from 'fs'
import { buildApp } from './app.js'
import { config } from './config.js'
import { connectRedis, closeRedis } from './db/redis.js'
import { closeDb } from './db/client.js'
import { startWorkers, stopWorkers } from './workers/metrics-poller.js'
import { startDeployWorker, stopDeployWorker } from './workers/deploy-runner.js'
import { startProvisioningWorker, stopProvisioningWorker } from './workers/provisioning-runner.js'

// Warn early if agent bundle is missing — deployments will fail at the download step
if (!existsSync(config.AGENT_BUNDLE_PATH)) {
  console.warn(
    `[warn] Agent bundle not found at "${config.AGENT_BUNDLE_PATH}". ` +
    `Run \`pnpm package:agent\` from the repo root to build it, ` +
    `then set AGENT_BUNDLE_PATH in env/control-plane.env if you moved it.`,
  )
}

await connectRedis()
await startWorkers()
await startDeployWorker()
await startProvisioningWorker()

const app = await buildApp()

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down...`)
  await app.close()
  await stopWorkers()
  await stopDeployWorker()
  await stopProvisioningWorker()
  await closeRedis()
  await closeDb()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await app.listen({ port: config.PORT, host: config.HOST })
