import { useEffect, type DependencyList } from 'react'
import { ws } from '@/lib/ws'
import type { ServerMessage } from '@ninja/types'

export function useWebSocket<T extends ServerMessage['type']>(
  type: T,
  handler: (msg: Extract<ServerMessage, { type: T }>) => void,
  deps: DependencyList = [],
): void {
  useEffect(() => {
    const unsubscribe = ws.on(type, (msg) => {
      if (msg.type === type) {
        handler(msg as Extract<ServerMessage, { type: T }>)
      }
    })
    return unsubscribe
  }, [type, ...deps])
}
