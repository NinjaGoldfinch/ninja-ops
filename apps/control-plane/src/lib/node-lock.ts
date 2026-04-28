import { redis } from '../db/redis.js'

const LOCK_TTL_SECONDS = 1800

export function nodeDeployLockKey(nodeId: string): string {
  return `agent-deploy:node:${nodeId}`
}

export async function acquireNodeLock(nodeId: string, jobId: string): Promise<boolean> {
  const result = await redis.set(nodeDeployLockKey(nodeId), jobId, 'EX', LOCK_TTL_SECONDS, 'NX')
  return result === 'OK'
}

export async function releaseNodeLock(nodeId: string): Promise<void> {
  await redis.del(nodeDeployLockKey(nodeId))
}

/**
 * Runs fn under the per-node deploy lock. Polls every 5 s until the lock is
 * available or timeoutMs elapses. Provisioning uses this so the job waits
 * in-process rather than failing and requiring a BullMQ retry cycle.
 */
export async function withNodeLock<T>(
  nodeId: string,
  jobId: string,
  fn: () => Promise<T>,
  timeoutMs = 300_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const locked = await acquireNodeLock(nodeId, jobId)
    if (locked) {
      try {
        return await fn()
      } finally {
        await releaseNodeLock(nodeId)
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for node deploy lock (nodeId=${nodeId})`)
    }
    await new Promise(r => setTimeout(r, 5_000))
  }
}
