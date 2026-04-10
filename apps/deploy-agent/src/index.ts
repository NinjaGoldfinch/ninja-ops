import './config.js'
import { log } from './logger.js'
import { register } from './register.js'
import { startConnection, closeConnection, setOnCommand } from './connection.js'
import { handleCommand, cancelActiveDeploy } from './runner.js'

log.info('Starting deploy-agent')

const { agentId, token } = await register()
log.info('Registered with control plane', { agentId })

setOnCommand((cmd) => handleCommand(cmd, agentId))
startConnection(agentId, token)

function shutdown(signal: string): void {
  log.info(`Received ${signal}, shutting down`)
  cancelActiveDeploy()
  closeConnection()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
