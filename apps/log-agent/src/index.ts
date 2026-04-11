import './config.js'
import { log } from './logger.js'
import { register } from './register.js'
import { startConnection, closeConnection } from './connection.js'

log.info('Starting log-agent')

const { agentId, token } = await register()
log.info('Registered', { agentId })

startConnection(agentId, token)

function shutdown(signal: string): void {
  log.info(`Received ${signal}, shutting down`)
  closeConnection()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
