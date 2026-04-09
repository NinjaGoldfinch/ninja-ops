import { buildApp } from './app.js'
import { config } from './config.js'
import { connectRedis, closeRedis } from './db/redis.js'
import { closeDb } from './db/client.js'
import { startWorkers, stopWorkers } from './workers/metrics-poller.js'
import { startDeployWorker, stopDeployWorker } from './workers/deploy-runner.js'

await connectRedis()
await startWorkers()
await startDeployWorker()

const app = await buildApp()

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down...`)
  await app.close()
  await stopWorkers()
  await stopDeployWorker()
  await closeRedis()
  await closeDb()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await app.listen({ port: config.PORT, host: config.HOST })
