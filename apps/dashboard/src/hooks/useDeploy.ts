import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { DeployTarget, DeployJob } from '@ninja/types'

export function useDeployTargets() {
  return useQuery({
    queryKey: ['deploy-targets'],
    queryFn: () => api.get<DeployTarget[]>('/api/deploy/targets'),
  })
}

export function useDeployTarget(targetId: string) {
  return useQuery({
    queryKey: ['deploy-targets', targetId],
    queryFn: () => api.get<DeployTarget>(`/api/deploy/targets/${targetId}`),
    enabled: !!targetId,
  })
}

interface CreateTargetInput {
  repository: string
  branch: string
  nodeId: string
  vmid: number
  workingDirectory: string
  restartCommand: string
  preDeployCommand?: string | undefined
  postDeployCommand?: string | undefined
  timeoutSeconds: number
}

interface UpdateTargetInput {
  branch?: string
  workingDirectory?: string
  restartCommand?: string
  preDeployCommand?: string
  postDeployCommand?: string
  timeoutSeconds?: number
}

export function useCreateDeployTarget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTargetInput) => api.post<DeployTarget>('/api/deploy/targets', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deploy-targets'] })
    },
  })
}

export function useUpdateDeployTarget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTargetInput }) =>
      api.put<DeployTarget>(`/api/deploy/targets/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deploy-targets'] })
    },
  })
}

export function useDeleteDeployTarget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/deploy/targets/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deploy-targets'] })
    },
  })
}

export interface JobFilters {
  targetId?: string
  state?: string
  limit?: number
}

export function useDeployJobs(filters: JobFilters = {}) {
  const params = new URLSearchParams()
  if (filters.targetId) params.set('targetId', filters.targetId)
  if (filters.state) params.set('state', filters.state)
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()

  return useQuery({
    queryKey: ['deploy-jobs', filters],
    queryFn: () => api.get<DeployJob[]>(`/api/deploy/jobs${qs ? `?${qs}` : ''}`),
  })
}

export function useDeployJob(jobId: string) {
  return useQuery({
    queryKey: ['deploy-jobs', jobId],
    queryFn: () => api.get<DeployJob>(`/api/deploy/jobs/${jobId}`),
    enabled: !!jobId,
  })
}

export function useTriggerDeploy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (targetId: string) =>
      api.post<DeployJob>(`/api/deploy/targets/${targetId}/trigger`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deploy-jobs'] })
    },
  })
}

export function useCancelDeployJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => api.post<void>(`/api/deploy/jobs/${jobId}/cancel`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deploy-jobs'] })
    },
  })
}
