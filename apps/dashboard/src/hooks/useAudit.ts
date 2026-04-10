import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AuditLogEntry } from '@ninja/types'

interface AuditResponse {
  items: AuditLogEntry[]
  total: number
  page: number
  limit: number
}

export function useAuditLog(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['audit', page, limit],
    queryFn: () =>
      api.get<AuditResponse>(`/api/audit?page=${page}&limit=${limit}`),
  })
}
