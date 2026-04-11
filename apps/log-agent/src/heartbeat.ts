import { config } from './config.js'
import { log } from './logger.js'
import { send } from './connection.js'

let heartbeatTimer: NodeJS.Timeout | null = null

export function startHeartbeat(agentId: string): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
  }

  heartbeatTimer = setInterval(() => {
    send({
      type:    'heartbeat',
      agentId,
      ts:      new Date().toISOString(),
    })
    log.trace('Heartbeat sent', { agentId })
  }, config.HEARTBEAT_INTERVAL_MS)
}

export function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    log.debug('Heartbeat stopped')
  }
}
