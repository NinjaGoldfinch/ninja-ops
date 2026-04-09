import type { WebSocket } from '@fastify/websocket'

// SSH terminal proxying is deferred to a later milestone.
// These stubs reject terminal requests with a clear message.

export function handleTerminalOpen(ws: WebSocket, sessionId: string): void {
  ws.send(JSON.stringify({
    type: 'terminal_closed',
    sessionId,
    reason: 'Terminal feature not yet implemented',
  }))
}

export function handleTerminalInput(_sessionId: string, _data: string): void {
  // no-op until SSH is implemented
}

export function handleTerminalResize(_sessionId: string, _cols: number, _rows: number): void {
  // no-op until SSH is implemented
}

export function handleTerminalClose(_sessionId: string): void {
  // no-op until SSH is implemented
}
