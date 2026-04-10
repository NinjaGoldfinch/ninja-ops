import { config } from './config.js'
import { log } from './logger.js'
import { send, currentJobId } from './connection.js'

let heartbeatTimer: NodeJS.Timeout | null = null

export function startHeartbeat(agentId: string): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
  }

  heartbeatTimer = setInterval(() => {
    const jobId = currentJobId
    send({
      type: 'heartbeat',
      payload: {
        agentId,
        status: jobId !== null ? 'busy' : 'idle',
        currentJobId: jobId,
        timestamp: new Date().toISOString(),
      },
    })
    log.trace('Heartbeat sent', { agentId, currentJobId: jobId })
  }, config.HEARTBEAT_INTERVAL_MS)
}

export function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    log.debug('Heartbeat stopped')
  }
}
