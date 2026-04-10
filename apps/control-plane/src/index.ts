import { buildApp } from './app.js'
import { config } from './config.js'
import { connectRedis, closeRedis } from './db/redis.js'
import { closeDb } from './db/client.js'
import { startWorkers, stopWorkers } from './workers/metrics-poller.js'
import { startDeployWorker, stopDeployWorker } from './workers/deploy-runner.js'
import { startProvisioningWorker, stopProvisioningWorker } from './workers/provisioning-runner.js'

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
