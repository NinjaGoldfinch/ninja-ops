import type { ApiError, LogQueryParams, LogStatsParams, LogStatsResponse, LogEntryRow, SavedLogFilter, CreateSavedLogFilter } from '@ninja/types'
import { useAuthStore } from '@/stores/auth'

const BASE = import.meta.env.VITE_API_URL ?? ''

class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { token, logout } = useAuthStore.getState()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : null,
  })

  if (response.status === 401) {
    logout()
    throw new ApiRequestError('UNAUTHORIZED', 'Session expired')
  }

  if (response.status === 204) {
    return undefined as T
  }

  let data: ({ ok: boolean; data?: T } & ApiError)
  try {
    data = (await response.json()) as { ok: boolean; data?: T } & ApiError
  } catch {
    throw new ApiRequestError(
      'PARSE_ERROR',
      `Unexpected response from server (status ${response.status})`,
    )
  }

  if (!response.ok || !data.ok) {
    throw new ApiRequestError(
      data.code ?? 'INTERNAL_ERROR',
      data.message ?? 'An unexpected error occurred',
      data.details,
    )
  }

  return (data as { ok: true; data: T }).data
}

function buildQs(params: Record<string, unknown>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, String(item))
    } else {
      qs.set(k, String(v))
    }
  }
  return qs.toString()
}

async function downloadBlob(path: string, params: Record<string, unknown>, filename: string): Promise<void> {
  const { token, logout } = useAuthStore.getState()
  const qs = buildQs(params)
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (res.status === 401) {
    logout()
    throw new ApiRequestError('UNAUTHORIZED', 'Session expired')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { code?: string; message?: string }
    throw new ApiRequestError(data.code ?? 'INTERNAL_ERROR', data.message ?? 'Export failed')
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),

  logs: {
    query: (params: Partial<LogQueryParams>) => {
      const qs = buildQs(params as Record<string, unknown>)
      return request<{ rows: LogEntryRow[]; nextCursor: number | null }>('GET', `/api/logs${qs ? `?${qs}` : ''}`)
    },
    stats: (params: Partial<LogStatsParams>) => {
      const qs = buildQs(params as Record<string, unknown>)
      return request<LogStatsResponse>('GET', `/api/logs/stats${qs ? `?${qs}` : ''}`)
    },
    export: (params: Partial<LogQueryParams> & { format: 'ndjson' | 'csv' }) => {
      const { format, ...rest } = params
      const ext = format === 'csv' ? 'csv' : 'ndjson'
      return downloadBlob('/api/logs/export', { ...rest, format } as Record<string, unknown>, `logs-export.${ext}`)
    },
    filters: {
      list: () => request<SavedLogFilter[]>('GET', '/api/logs/filters'),
      create: (body: CreateSavedLogFilter) => request<SavedLogFilter>('POST', '/api/logs/filters', body),
      delete: (id: string) => request<void>('DELETE', `/api/logs/filters/${id}`),
    },
    retention: {
      get: () => request<{ retentionDays: number }>('GET', '/api/logs/retention'),
      set: (retentionDays: number) => request<{ retentionDays: number }>('PUT', '/api/logs/retention', { retentionDays }),
    },
  },
}

export { ApiRequestError }
