import { Queue, Worker } from 'bullmq'
import { bullmqConnection } from '../db/redis.js'
import { logService } from '../services/log.js'

const QUEUE_NAME     = 'log-purge'
const RETENTION_DAYS = 30

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
    const deleted = await logService.purgeOlderThan(RETENTION_DAYS)
    console.info(`[log-purge] Deleted ${deleted} entries older than ${RETENTION_DAYS} days`)
  }, { connection: bullmqConnection })

  purgeWorker.on('failed', (job, err) => {
    console.error(`[log-purge] Job ${job?.id ?? 'unknown'} failed:`, err.message)
  })
}

export async function stopLogPurgeWorker(): Promise<void> {
  await purgeWorker?.close()
  await purgeQueue?.close()
}
