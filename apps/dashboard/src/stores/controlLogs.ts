import { create } from 'zustand'
import { ws } from '@/lib/ws'

export interface ControlLogLine {
  stream: 'stdout' | 'stderr'
  data: string
  ts: number
}

interface ControlLogsState {
  lines: ControlLogLine[]
  active: boolean
  connect: () => void
  disconnect: () => void
  clear: () => void
}

let unsubscribe: (() => void) | null = null

export const useControlLogsStore = create<ControlLogsState>((set, get) => ({
  lines: [],
  active: false,

  connect() {
    if (get().active) return
    ws.send({ type: 'subscribe_control_logs' })
    unsubscribe = ws.on('control_log', (msg) => {
      if (msg.type !== 'control_log') return
      set((s) => ({
        lines: [...s.lines, { stream: msg.stream, data: msg.data, ts: msg.ts }],
      }))
    })
    set({ active: true })
  },

  disconnect() {
    ws.send({ type: 'unsubscribe_control_logs' })
    unsubscribe?.()
    unsubscribe = null
    set({ active: false })
  },

  clear() {
    set({ lines: [] })
  },
}))
