// Intercepts process.stdout / process.stderr, keeps a circular buffer of
// recent lines, and broadcasts to WebSocket clients subscribed to control logs.

const MAX_BUFFER = 500

interface LogEntry {
  stream: 'stdout' | 'stderr'
  data: string
  ts: number
}

const buffer: LogEntry[] = []

type Broadcaster = (entry: LogEntry) => void
let broadcaster: Broadcaster | null = null

export function setLogBroadcaster(fn: Broadcaster): void {
  broadcaster = fn
}

export function getLogBuffer(): LogEntry[] {
  return buffer.slice()
}

function intercept(stream: 'stdout' | 'stderr', original: NodeJS.WriteStream): void {
  const originalWrite = original.write.bind(original)

  original.write = (
    chunk: Uint8Array | string,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean => {
    const data = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    const entry: LogEntry = { stream, data, ts: Date.now() }

    if (buffer.length >= MAX_BUFFER) buffer.shift()
    buffer.push(entry)

    try {
      broadcaster?.(entry)
    } catch {
      // never let broadcaster errors break actual logging
    }

    // call through to the real write
    if (typeof encodingOrCb === 'function') {
      return originalWrite(chunk, encodingOrCb)
    }
    return originalWrite(chunk, encodingOrCb as BufferEncoding, cb)
  }
}

export function initLogInterceptor(): void {
  intercept('stdout', process.stdout)
  intercept('stderr', process.stderr)
}
