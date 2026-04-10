import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ws } from '@/lib/ws'
import type { ProvisioningJob, LxcCreateRequest, QemuCreateRequest, ProxmoxTemplate, ProxmoxIso, ProxmoxStorage } from '@ninja/types'

export function useProvisioningJobs(nodeId?: string) {
  const qs = nodeId ? `?nodeId=${nodeId}` : ''
  return useQuery({
    queryKey: ['provisioning-jobs', nodeId],
    queryFn: () => api.get<ProvisioningJob[]>(`/api/provisioning/jobs${qs}`),
  })
}

export function useProvisioningJob(jobId: string) {
  return useQuery({
    queryKey: ['provisioning-jobs', jobId],
    queryFn: () => api.get<ProvisioningJob>(`/api/provisioning/jobs/${jobId}`),
    enabled: !!jobId,
  })
}

export function useCreateLxc() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: LxcCreateRequest) =>
      api.post<ProvisioningJob>('/api/provisioning/lxc', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['provisioning-jobs'] })
    },
  })
}

export function useCreateQemu() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: QemuCreateRequest) =>
      api.post<ProvisioningJob>('/api/provisioning/qemu', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['provisioning-jobs'] })
    },
  })
}

export function useDeleteProvisioningJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => api.delete<void>(`/api/provisioning/jobs/${jobId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['provisioning-jobs'] })
    },
  })
}

export function useNodeTemplates(nodeId: string) {
  return useQuery({
    queryKey: ['provisioning-templates', nodeId],
    queryFn: () => api.get<ProxmoxTemplate[]>(`/api/provisioning/nodes/${nodeId}/templates`),
    enabled: !!nodeId,
  })
}

export function useNodeIsos(nodeId: string) {
  return useQuery({
    queryKey: ['provisioning-isos', nodeId],
    queryFn: () => api.get<ProxmoxIso[]>(`/api/provisioning/nodes/${nodeId}/isos`),
    enabled: !!nodeId,
  })
}

export function useNodeStorages(nodeId: string) {
  return useQuery({
    queryKey: ['provisioning-storages', nodeId],
    queryFn: () => api.get<ProxmoxStorage[]>(`/api/provisioning/nodes/${nodeId}/storages`),
    enabled: !!nodeId,
  })
}

export function useProvisioningLiveUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsub = ws.on('provisioning_update', (msg) => {
      if (msg.type !== 'provisioning_update') return
      queryClient.setQueryData(['provisioning-jobs', msg.data.id], msg.data)
      void queryClient.invalidateQueries({ queryKey: ['provisioning-jobs'] })
    })
    return unsub
  }, [queryClient])
}
