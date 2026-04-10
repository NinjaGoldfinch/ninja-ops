import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { ws } from '@/lib/ws'
import type { Agent } from '@ninja/types'

export function useAgents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsub = ws.on('agent_status', () => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] })
    })
    return unsub
  }, [queryClient])

  return useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<Agent[]>('/api/agents'),
  })
}

export function useDeleteAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) => api.delete<void>(`/api/agents/${agentId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}
