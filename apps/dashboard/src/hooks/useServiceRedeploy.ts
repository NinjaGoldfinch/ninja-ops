import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ws } from '@/lib/ws'
import type { ServiceRedeployJob, ServiceVersion, ServiceName } from '@ninja/types'

type ServiceVersions = Record<ServiceName, ServiceVersion>

export function useServiceVersions() {
  return useQuery({
    queryKey: ['service-versions'],
    queryFn: () => api.get<ServiceVersions>('/api/services/versions'),
    refetchInterval: 5 * 60 * 1000,
  })
}

export function useRedeployService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ service, targetVersion }: { service: ServiceName; targetVersion?: string }) =>
      api.post<ServiceRedeployJob>(`/api/services/${service}/redeploy`, { targetVersion }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-versions'] })
      void queryClient.invalidateQueries({ queryKey: ['service-redeploy-jobs'] })
    },
  })
}

export function useServiceRedeployJobs(service?: ServiceName) {
  const qs = service ? `?service=${service}` : ''
  return useQuery({
    queryKey: ['service-redeploy-jobs', service],
    queryFn: () => api.get<ServiceRedeployJob[]>(`/api/services/redeploy-jobs${qs}`),
  })
}

export function useServiceRedeployJob(jobId: string | null) {
  return useQuery({
    queryKey: ['service-redeploy-jobs', 'detail', jobId],
    queryFn: () => api.get<ServiceRedeployJob>(`/api/services/redeploy-jobs/${jobId!}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.state
      return state === 'queued' || state === 'running' ? 2000 : false
    },
  })
}

export function useCancelServiceRedeploy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) =>
      api.post<ServiceRedeployJob>(`/api/services/redeploy-jobs/${jobId}/cancel`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-redeploy-jobs'] })
    },
  })
}

export function useServiceRedeployLiveUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsubRedeploy = ws.on('service_redeploy_update', (msg) => {
      if (msg.type !== 'service_redeploy_update') return
      queryClient.setQueryData(['service-redeploy-jobs', 'detail', msg.data.id], msg.data)
      void queryClient.invalidateQueries({ queryKey: ['service-redeploy-jobs'] })
    })

    const unsubVersions = ws.on('service_version_update', (msg) => {
      if (msg.type !== 'service_version_update') return
      queryClient.setQueryData(['service-versions'], msg.data)
    })

    return () => {
      unsubRedeploy()
      unsubVersions()
    }
  }, [queryClient])
}
