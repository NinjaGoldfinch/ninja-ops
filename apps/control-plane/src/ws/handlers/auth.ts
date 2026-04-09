import type { WebSocket } from '@fastify/websocket'
import { verifyToken } from '../../plugins/auth.js'
import { sessionManager } from '../session.js'

export async function handleAuth(
  connectionId: string,
  ws: WebSocket,
  token: string,
): Promise<void> {
  try {
    const payload = await verifyToken(token)
    sessionManager.authenticate(connectionId, payload.sub, payload.role)
    ws.send(JSON.stringify({
      type: 'auth_ok',
      userId: payload.sub,
      role: payload.role,
    }))
  } catch {
    ws.send(JSON.stringify({
      type: 'auth_error',
      message: 'Invalid or expired token',
    }))
    ws.close(1008, 'Unauthorized')
  }
}
