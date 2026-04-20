import { Queue, Worker } from 'bullmq'
import { bullmqConnection } from '../db/redis.js'
import { childLogger } from '../lib/logger.js'
import { sql } from '../db/client.js'

const log = childLogger('metrics-poller')
import { proxmoxService } from '../services/proxmox.js'
import { cryptoService } from '../services/crypto.js'
import { sessionManager } from '../ws/session.js'

const QUEUE_NAME = 'metrics-poll'
const REPEAT_INTERVAL_MS = 5_000

interface DbNode {
  id: string
  name: string
  host: string
  port: number
  token_id: string
  token_secret: string
  status: string
}

let metricsQueue: Queue | null = null
let metricsWorker: Worker | null = null

async function pollMetrics(): Promise<void> {
  const nodes = await sql<DbNode[]>`
    SELECT id, name, host, port, token_id, token_secret, status
    FROM nodes
    WHERE status = 'online'
  `

  await Promise.allSettled(
    nodes.map(async (node) => {
      try {
        const tokenSecret = cryptoService.decrypt(node.token_secret)
        const cfg = {
          host: node.host,
          port: node.port,
          tokenId: node.token_id,
          tokenSecret,
          nodeName: node.name,
        }
        const { node: nodeMetrics, guests } = await proxmoxService.getMetrics(cfg, node.id)

        // Broadcast node metrics to subscribed clients
        sessionManager.broadcastNodeMetrics(node.id, nodeMetrics)

        // Broadcast per-guest metrics
        for (const guestMetrics of guests) {
          sessionManager.broadcastGuestMetrics(node.id, guestMetrics.vmid, guestMetrics)
        }
      } catch (err) {
        log.error({ nodeId: node.id, err: err as Error }, 'Failed to poll node')
      }
    }),
  )
}

export async function startWorkers(): Promise<void> {
  const connection = bullmqConnection

  metricsQueue = new Queue(QUEUE_NAME, { connection })

  // Schedule repeatable job
  await metricsQueue.add(
    'poll',
    {},
    {
      repeat: { every: REPEAT_INTERVAL_MS },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  )

  metricsWorker = new Worker(
    QUEUE_NAME,
    async () => {
      await pollMetrics()
    },
    { connection },
  )

  metricsWorker.on('failed', (job, err) => {
    log.error({ bullmqJobId: job?.id ?? 'unknown', err }, 'Metrics poll job failed')
  })
}

export async function stopWorkers(): Promise<void> {
  await metricsWorker?.close()
  await metricsQueue?.close()
}
