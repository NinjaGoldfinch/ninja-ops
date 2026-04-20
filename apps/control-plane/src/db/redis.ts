import { Redis } from 'ioredis'
import { config } from '../config.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('redis')

// General-purpose connection (app cache, pub/sub, etc.)
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
})

redis.on('error', (err: Error) => {
  log.error({ err }, 'Redis connection error')
})

// BullMQ requires maxRetriesPerRequest: null for its blocking commands
export const bullmqConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

bullmqConnection.on('error', (err: Error) => {
  log.error({ err }, 'BullMQ Redis connection error')
})

export async function connectRedis(): Promise<void> {
  await redis.connect()
}

export async function closeRedis(): Promise<void> {
  await redis.quit()
  await bullmqConnection.quit()
}
