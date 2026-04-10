import { Redis } from 'ioredis'
import { config } from '../config.js'

// General-purpose connection (app cache, pub/sub, etc.)
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
})

redis.on('error', (err: Error) => {
  console.error('[redis] connection error:', err)
})

// BullMQ requires maxRetriesPerRequest: null for its blocking commands
export const bullmqConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

bullmqConnection.on('error', (err: Error) => {
  console.error('[redis:bullmq] connection error:', err)
})

export async function connectRedis(): Promise<void> {
  await redis.connect()
}

export async function closeRedis(): Promise<void> {
  await redis.quit()
  await bullmqConnection.quit()
}
