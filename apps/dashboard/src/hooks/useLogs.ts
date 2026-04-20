import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { ws } from '@/lib/ws'
import type { LogEntryRow, LogQueryParams, LogStatsParams, CreateSavedLogFilter } from '@ninja/types'

// ── Historical paginated query (infinite / cursor-based) ──────────────────

export function useLogs(params: Partial<LogQueryParams>) {
  return useInfiniteQuery({
    queryKey: ['logs', params],
    queryFn: ({ pageParam }) =>
      api.logs.query({ ...params, cursor: pageParam as number | undefined }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

// Legacy single-page query used by the current logs page
export function useLogHistory(params: Partial<LogQueryParams>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v))
  }
  return useQuery({
    queryKey: ['logs-page', params],
    queryFn: () => api.logs.query(params),
    enabled: !!(params.vmid ?? params.nodeId),
  })
}

// ── Stats for histogram ───────────────────────────────────────────────────

export function useLogStats(params: Partial<LogStatsParams>) {
  return useQuery({
    queryKey: ['log-stats', params],
    queryFn: () => api.logs.stats(params),
    refetchInterval: 30_000,
  })
}

// ── Saved filters CRUD ────────────────────────────────────────────────────

export function useSavedFilters() {
  const queryClient = useQueryClient()

  const list = useQuery({
    queryKey: ['log-filters'],
    queryFn: api.logs.filters.list,
  })

  const create = useMutation({
    mutationFn: (body: CreateSavedLogFilter) => api.logs.filters.create(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['log-filters'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.logs.filters.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['log-filters'] }),
  })

  return { list, create, remove }
}

// ── Live WS stream with server-side filter ────────────────────────────────

const RING_BUFFER_SIZE = 500

export function useLogStream(filter: Partial<LogQueryParams>) {
  const [lines, setLines] = useState<LogEntryRow[]>([])
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!active) return

    ws.send({ type: 'subscribe_logs_filtered', payload: { filter } })

    const unsub = ws.on('log_line', (msg) => {
      if (msg.type === 'log_line') {
        setLines((prev) => [msg.data, ...prev].slice(0, RING_BUFFER_SIZE))
      }
    })

    return () => {
      unsub()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, JSON.stringify(filter)])

  return {
    lines,
    isLive: active,
    start: () => setActive(true),
    stop: () => setActive(false),
    clear: () => setLines([]),
  }
}

// ── Legacy vmid-based live log hook ──────────────────────────────────────

export function useLiveLogs(vmid: number | undefined): LogEntryRow[] {
  const [lines, setLines] = useState<LogEntryRow[]>([])

  useEffect(() => {
    if (!vmid) return
    ws.send({ type: 'subscribe_logs', vmid })

    const unsub = ws.on('log_line', (msg) => {
      if (msg.type === 'log_line' && msg.data.vmid === vmid) {
        setLines((prev) => [msg.data, ...prev].slice(0, 500))
      }
    })

    return () => {
      unsub()
      ws.send({ type: 'unsubscribe_logs', vmid })
    }
  }, [vmid])

  return lines
}
