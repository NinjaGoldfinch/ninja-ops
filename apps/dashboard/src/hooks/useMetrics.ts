import { useEffect } from 'react'
import { ws } from '@/lib/ws'
import { useMetricsStore } from '@/stores/metrics'
import type { GuestMetrics, NodeMetrics } from '@ninja/types'

export function useGuestMetrics(
  nodeId: string,
  vmid: number,
): { latest: GuestMetrics | null; history: GuestMetrics[] } {
  // Subscribe to live guest metrics while mounted
  useEffect(() => {
    ws.send({ type: 'subscribe_metrics', nodeId, vmid })
    return () => {
      ws.send({ type: 'unsubscribe_metrics', nodeId, vmid })
    }
  }, [nodeId, vmid])

  const key = `${nodeId}:${vmid}`
  const history = useMetricsStore((s) => s.guestHistory.get(key) ?? [])
  return { latest: history[history.length - 1] ?? null, history }
}

export function useNodeMetrics(nodeId: string): { latest: NodeMetrics | null; history: NodeMetrics[] } {
  const history = useMetricsStore((s) => s.nodeHistory.get(nodeId) ?? [])
  return { latest: history[history.length - 1] ?? null, history }
}
