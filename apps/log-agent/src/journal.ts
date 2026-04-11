import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { priorityToLevel } from './priority.js'
import { config } from './config.js'
import { log } from './logger.js'

const CURSOR_FILE = '/opt/ninja-log-agent/cursor'

export interface ParsedLogLine {
  unit:   string | undefined
  level:  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  line:   string
  ts:     number   // unix ms
}

export type LogSource = 'app' | 'agent' | 'shell' | 'system'

export type LineHandler = (parsed: ParsedLogLine, source: LogSource) => void

function loadCursor(): string | undefined {
  try {
    if (existsSync(CURSOR_FILE)) {
      return readFileSync(CURSOR_FILE, 'utf8').trim() || undefined
    }
  } catch {
    // Cursor file unreadable — start from now
  }
  return undefined
}

function saveCursor(cursor: string): void {
  try {
    writeFileSync(CURSOR_FILE, cursor, 'utf8')
  } catch {
    // Non-fatal — worst case we re-send a few lines on restart
  }
}

function tailUnits(units: string[], onLine: LineHandler): () => void {
  const cursor = loadCursor()

  const args = [
    '--follow',
    '--output=json',
    '--no-pager',
    ...(cursor ? [`--after-cursor=${cursor}`] : ['--lines=0']),
    ...units.flatMap(u => ['--unit', u]),
  ]

  log.debug('Starting journalctl', { args: args.join(' ') })

  const child = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] })

  let buf = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buf += chunk
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const raw of lines) {
      if (!raw.trim()) continue
      try {
        const entry = JSON.parse(raw) as Record<string, string>

        const unit = entry['_SYSTEMD_UNIT'] ?? entry['UNIT']
        const level = priorityToLevel(parseInt(entry['PRIORITY'] ?? '6', 10))
        const line = entry['MESSAGE'] ?? ''
        // __REALTIME_TIMESTAMP is microseconds — convert to ms
        const ts = Math.floor(Number(entry['__REALTIME_TIMESTAMP'] ?? Date.now() * 1000) / 1000)

        const parsed: ParsedLogLine = { unit, level, line, ts }

        let source: LogSource = 'app'
        if (unit === 'ninja-agent.service' || unit === 'ninja-log-agent.service') {
          source = 'agent'
        }

        onLine(parsed, source)

        if (entry['__CURSOR']) saveCursor(entry['__CURSOR'])
      } catch {
        // Malformed JSON — journald can emit partial lines on startup
      }
    }
  })

  child.stderr.on('data', (d: Buffer) => {
    log.warn('journalctl stderr', { data: d.toString().trim() })
  })

  child.on('close', (code) => {
    log.warn('journalctl exited', { code })
  })

  return () => {
    child.kill()
  }
}

export function startJournal(onLine: LineHandler): () => void {
  const units: string[] = ['ninja-agent.service', 'ninja-log-agent.service']

  if (config.LOG_UNITS) {
    units.push(...config.LOG_UNITS.split(',').map(u => u.trim()).filter(Boolean))
  }

  if (config.LOG_SYSTEM) {
    units.push('systemd-journald.service')
  }

  log.info('Tailing units', { units })
  return tailUnits(units, onLine)
}
