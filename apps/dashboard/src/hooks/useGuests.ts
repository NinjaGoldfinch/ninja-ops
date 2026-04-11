import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Guest, PowerAction, Snapshot, CreateSnapshotRequest } from '@ninja/types'

export function useDeleteGuest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, vmid }: { nodeId: string; vmid: number }) =>
      api.delete<void>(`/api/nodes/${nodeId}/guests/${vmid}`),
    onSuccess: (_data, { nodeId }) => {
      void queryClient.invalidateQueries({ queryKey: ['guests', nodeId] })
    },
  })
}

export function useGuests(nodeId: string) {
  return useQuery({
    queryKey: ['guests', nodeId],
    queryFn: () => api.get<Guest[]>(`/api/nodes/${nodeId}/guests`),
    enabled: !!nodeId,
  })
}

export function useGuest(nodeId: string, vmid: number) {
  return useQuery({
    queryKey: ['guests', nodeId, vmid],
    queryFn: () => api.get<Guest>(`/api/nodes/${nodeId}/guests/${vmid}`),
    enabled: !!nodeId && vmid > 0,
  })
}

export function usePowerAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      nodeId,
      vmid,
      action,
    }: {
      nodeId: string
      vmid: number
      action: PowerAction
    }) => api.post<void>(`/api/nodes/${nodeId}/guests/${vmid}/power`, { action }),
    onSuccess: (_data, { nodeId }) => {
      void queryClient.invalidateQueries({ queryKey: ['guests', nodeId] })
    },
  })
}

export function useSnapshots(nodeId: string, vmid: number) {
  return useQuery({
    queryKey: ['snapshots', nodeId, vmid],
    queryFn: () => api.get<Snapshot[]>(`/api/nodes/${nodeId}/guests/${vmid}/snapshots`),
    enabled: !!nodeId && vmid > 0,
  })
}

export function useCreateSnapshot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      nodeId,
      vmid,
      input,
    }: {
      nodeId: string
      vmid: number
      input: CreateSnapshotRequest
    }) => api.post<Snapshot>(`/api/nodes/${nodeId}/guests/${vmid}/snapshots`, input),
    onSuccess: (_data, { nodeId, vmid }) => {
      void queryClient.invalidateQueries({ queryKey: ['snapshots', nodeId, vmid] })
    },
  })
}

export function useDeployAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, vmid }: { nodeId: string; vmid: number }) =>
      api.post<{ deployed: boolean; sessionId: string }>(`/api/nodes/${nodeId}/guests/${vmid}/deploy-agent`, {}),
    onSuccess: (_data, { nodeId, vmid }) => {
      void queryClient.invalidateQueries({ queryKey: ['job-logs', 'job', 'agent_deploy', `${nodeId}/${vmid}`] })
    },
  })
}

export function useDeleteSnapshot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      nodeId,
      vmid,
      name,
    }: {
      nodeId: string
      vmid: number
      name: string
    }) => api.delete<void>(`/api/nodes/${nodeId}/guests/${vmid}/snapshots/${name}`),
    onSuccess: (_data, { nodeId, vmid }) => {
      void queryClient.invalidateQueries({ queryKey: ['snapshots', nodeId, vmid] })
    },
  })
}
