import { useEffect, useRef, useState } from 'react'
import { ws } from '@/lib/ws'
import type { GuestMetrics, NodeMetrics } from '@ninja/types'

const RING_BUFFER_SIZE = 60

export function useGuestMetrics(
  nodeId: string,
  vmid: number,
): { latest: GuestMetrics | null; history: GuestMetrics[] } {
  const historyRef = useRef<GuestMetrics[]>([])
  const [, setTick] = useState(0)

  useEffect(() => {
    ws.send({ type: 'subscribe_metrics', nodeId, vmid })

    const unsubscribe = ws.on('metrics_guest', (msg) => {
      if (msg.type === 'metrics_guest' && msg.data.nodeId === nodeId && msg.data.vmid === vmid) {
        historyRef.current = [
          ...historyRef.current.slice(-(RING_BUFFER_SIZE - 1)),
          msg.data,
        ]
        setTick((t) => t + 1)
      }
    })

    return () => {
      unsubscribe()
      ws.send({ type: 'unsubscribe_metrics', nodeId, vmid })
    }
  }, [nodeId, vmid])

  const history = historyRef.current
  return {
    latest: history[history.length - 1] ?? null,
    history,
  }
}

export function useNodeMetrics(nodeId: string): { latest: NodeMetrics | null; history: NodeMetrics[] } {
  const historyRef = useRef<NodeMetrics[]>([])
  const [, setTick] = useState(0)

  useEffect(() => {
    const unsubscribe = ws.on('metrics_node', (msg) => {
      if (msg.type === 'metrics_node' && msg.data.nodeId === nodeId) {
        historyRef.current = [
          ...historyRef.current.slice(-(RING_BUFFER_SIZE - 1)),
          msg.data,
        ]
        setTick((t) => t + 1)
      }
    })
    return unsubscribe
  }, [nodeId])

  const history = historyRef.current
  return {
    latest: history[history.length - 1] ?? null,
    history,
  }
}
