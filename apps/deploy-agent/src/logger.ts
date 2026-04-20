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

export interface Logger {
  trace: (msg: string, data?: Record<string, unknown>) => void
  debug: (msg: string, data?: Record<string, unknown>) => void
  info:  (msg: string, data?: Record<string, unknown>) => void
  warn:  (msg: string, data?: Record<string, unknown>) => void
  error: (msg: string, data?: Record<string, unknown>) => void
  child: (bindings: Record<string, unknown>) => Logger
}

function createChild(bindings: Record<string, unknown>): Logger {
  return {
    trace: (msg, data) => write('trace', msg, { ...bindings, ...data }),
    debug: (msg, data) => write('debug', msg, { ...bindings, ...data }),
    info:  (msg, data) => write('info',  msg, { ...bindings, ...data }),
    warn:  (msg, data) => write('warn',  msg, { ...bindings, ...data }),
    error: (msg, data) => write('error', msg, { ...bindings, ...data }),
    child: (extra) => createChild({ ...bindings, ...extra }),
  }
}

export const log: Logger = {
  trace: (msg, data) => write('trace', msg, data),
  debug: (msg, data) => write('debug', msg, data),
  info:  (msg, data) => write('info',  msg, data),
  warn:  (msg, data) => write('warn',  msg, data),
  error: (msg, data) => write('error', msg, data),
  child: (bindings) => createChild(bindings),
}
