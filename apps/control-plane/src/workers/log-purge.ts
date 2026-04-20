import { Queue, Worker } from 'bullmq'
import { bullmqConnection } from '../db/redis.js'
import { childLogger } from '../lib/logger.js'
import { config } from '../config.js'
import { logService } from '../services/log.js'

const log = childLogger('log-purge')

const QUEUE_NAME = 'log-purge'

let purgeQueue:  Queue  | null = null
let purgeWorker: Worker | null = null

export async function startLogPurgeWorker(): Promise<void> {
  purgeQueue = new Queue(QUEUE_NAME, { connection: bullmqConnection })

  await purgeQueue.add('purge', {}, {
    repeat: {
      pattern: '0 3 * * *',
    },
    removeOnComplete: { count: 3 },
    removeOnFail:     { count: 3 },
  })

  purgeWorker = new Worker(QUEUE_NAME, async () => {
    const deleted = await logService.purgeOlderThan(config.LOG_RETENTION_DAYS)
    log.info({ deleted, retentionDays: config.LOG_RETENTION_DAYS }, 'Purged old log entries')
  }, { connection: bullmqConnection })

  purgeWorker.on('failed', (job, err) => {
    log.error({ bullmqJobId: job?.id ?? 'unknown', err }, 'Log purge job failed')
  })
}

export async function stopLogPurgeWorker(): Promise<void> {
  await purgeWorker?.close()
  await purgeQueue?.close()
}
