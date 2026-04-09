import { Redis } from 'ioredis'
import { config } from '../config.js'

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
})

redis.on('error', (err: Error) => {
  console.error('[redis] connection error:', err)
})

export async function connectRedis(): Promise<void> {
  await redis.connect()
}

export async function closeRedis(): Promise<void> {
  await redis.quit()
}
