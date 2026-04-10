import { config } from './config.js'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
}

const configuredPriority = LEVEL_PRIORITY[config.LOG_LEVEL]

function write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < configuredPriority) return
  const entry = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data })
  if (level === 'warn' || level === 'error') {
    process.stderr.write(entry + '\n')
  } else {
    process.stdout.write(entry + '\n')
  }
}

export const log = {
  trace: (msg: string, data?: Record<string, unknown>) => write('trace', msg, data),
  debug: (msg: string, data?: Record<string, unknown>) => write('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data),
}
