import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ws } from '@/lib/ws'
import type { AgentRedeployJob, BundleInfo, EnqueueAllRequest } from '@ninja/types'

export function useBundleInfo() {
  return useQuery({
    queryKey: ['bundle-info'],
    queryFn: () => api.get<BundleInfo>('/api/agents/bundle-info'),
  })
}

export function useRedeployAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) =>
      api.post<AgentRedeployJob>(`/api/agents/${agentId}/redeploy`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-redeploy-jobs'] })
    },
  })
}

export function useRedeployAll() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: EnqueueAllRequest) =>
      api.post<AgentRedeployJob[]>('/api/agents/redeploy-all', params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-redeploy-jobs'] })
    },
  })
}

export function useRedeployJobs(agentId?: string) {
  const qs = agentId ? `?agentId=${agentId}` : ''
  return useQuery({
    queryKey: ['agent-redeploy-jobs', agentId],
    queryFn: () => api.get<AgentRedeployJob[]>(`/api/agents/redeploy-jobs${qs}`),
  })
}

export function useRedeployJob(jobId: string | null) {
  return useQuery({
    queryKey: ['agent-redeploy-jobs', 'detail', jobId],
    queryFn: () => api.get<AgentRedeployJob>(`/api/agents/redeploy-jobs/${jobId!}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.state
      return state === 'queued' || state === 'running' ? 2000 : false
    },
  })
}

export function useCancelRedeploy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) =>
      api.post<AgentRedeployJob>(`/api/agents/redeploy-jobs/${jobId}/cancel`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-redeploy-jobs'] })
    },
  })
}

export function useRedeployLiveUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsub = ws.on('redeploy_update', (msg) => {
      if (msg.type !== 'redeploy_update') return
      queryClient.setQueryData(['agent-redeploy-jobs', 'detail', msg.data.id], msg.data)
      void queryClient.invalidateQueries({ queryKey: ['agent-redeploy-jobs'] })
      // Also invalidate agents so version column clears when a redeploy succeeds
      void queryClient.invalidateQueries({ queryKey: ['agents'] })
    })
    return unsub
  }, [queryClient])
}
