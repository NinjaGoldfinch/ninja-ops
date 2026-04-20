import { hostname } from 'node:os'
import pino from 'pino'
import { config } from '../config.js'

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { hostname: hostname(), pid: process.pid },
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    '*.password',
    '*.token',
    '*.secret',
    '*.tokenSecret',
  ],
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty' } }
    : {}),
})

export function childLogger(component: string) {
  return logger.child({ component })
}
