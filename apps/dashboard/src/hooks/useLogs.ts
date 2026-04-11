import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { ws } from '@/lib/ws'
import type { LogEntryRow } from '@ninja/types'

export interface LogQueryParams {
  vmid?: number
  nodeId?: string
  source?: string
  level?: string
  unit?: string
  search?: string
  from?: number
  to?: number
  limit?: number
  cursor?: number
}

export function useLogHistory(params: LogQueryParams) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v))
  }
  return useQuery({
    queryKey: ['logs', params],
    queryFn: () => api.get<{ rows: LogEntryRow[]; nextCursor: number | null }>(`/api/logs?${qs.toString()}`),
    enabled: !!(params.vmid || params.nodeId),
  })
}

export function useLiveLogs(vmid: number | undefined): LogEntryRow[] {
  const liveLines = useRef<LogEntryRow[]>([])
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!vmid) return
    ws.send({ type: 'subscribe_logs', vmid })

    const unsub = ws.on('log_line', (msg) => {
      if (msg.type === 'log_line' && msg.data.vmid === vmid) {
        liveLines.current = [msg.data, ...liveLines.current].slice(0, 500)
        setTick((t) => t + 1)
      }
    })

    return () => {
      unsub()
      ws.send({ type: 'unsubscribe_logs', vmid })
    }
  }, [vmid])

  return liveLines.current
}
