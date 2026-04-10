import { create } from 'zustand'
import { ws } from '@/lib/ws'
import type { NodeMetrics, GuestMetrics } from '@ninja/types'

const RING_SIZE = 60

interface MetricsState {
  // nodeId -> ring buffer
  nodeHistory: Map<string, NodeMetrics[]>
  // "nodeId:vmid" -> ring buffer
  guestHistory: Map<string, GuestMetrics[]>

  _pushNode: (data: NodeMetrics) => void
  _pushGuest: (data: GuestMetrics) => void
}

export const useMetricsStore = create<MetricsState>((set) => ({
  nodeHistory: new Map(),
  guestHistory: new Map(),

  _pushNode(data) {
    set((s) => {
      const next = new Map(s.nodeHistory)
      const prev = next.get(data.nodeId) ?? []
      next.set(data.nodeId, [...prev.slice(-(RING_SIZE - 1)), data])
      return { nodeHistory: next }
    })
  },

  _pushGuest(data) {
    set((s) => {
      const key = `${data.nodeId}:${data.vmid}`
      const next = new Map(s.guestHistory)
      const prev = next.get(key) ?? []
      next.set(key, [...prev.slice(-(RING_SIZE - 1)), data])
      return { guestHistory: next }
    })
  },
}))

// Start a single persistent WS listener. Called once from main.tsx after WS is connected.
let listening = false
export function startMetricsListener() {
  if (listening) return
  listening = true

  ws.on('metrics_node', (msg) => {
    if (msg.type === 'metrics_node') {
      useMetricsStore.getState()._pushNode(msg.data)
    }
  })

  ws.on('metrics_guest', (msg) => {
    if (msg.type === 'metrics_guest') {
      useMetricsStore.getState()._pushGuest(msg.data)
    }
  })
}
