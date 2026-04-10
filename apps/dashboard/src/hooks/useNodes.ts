import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ProxmoxNode } from '@ninja/types'

export function useNodes() {
  return useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.get<ProxmoxNode[]>('/api/nodes'),
  })
}

export function useNode(nodeId: string) {
  return useQuery({
    queryKey: ['nodes', nodeId],
    queryFn: () => api.get<ProxmoxNode>(`/api/nodes/${nodeId}`),
    enabled: !!nodeId,
  })
}

interface CreateNodeInput {
  name: string
  host: string
  port: number
  tokenId: string
  tokenSecret: string
  sshUser?: string
  sshPassword?: string
  sshHost?: string
}

export function useCreateNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateNodeInput) => api.post<ProxmoxNode>('/api/nodes', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nodes'] })
    },
  })
}

interface UpdateNodeInput {
  name?: string
  host?: string
  port?: number
  tokenId?: string
  tokenSecret?: string
  sshUser?: string
  sshPassword?: string
  sshHost?: string
}

export function useUpdateNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, input }: { nodeId: string; input: UpdateNodeInput }) =>
      api.put<ProxmoxNode>(`/api/nodes/${nodeId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nodes'] })
    },
  })
}

export function useDeleteNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (nodeId: string) => api.delete<void>(`/api/nodes/${nodeId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nodes'] })
    },
  })
}

interface TestConnectionInput {
  host: string
  port: number
  tokenId: string
  tokenSecret?: string
  nodeId?: string
}

export function useTestNodeConnection() {
  return useMutation({
    mutationFn: (input: TestConnectionInput) => api.post<{ success: boolean }>('/api/nodes/test', input),
  })
}

export function useSyncNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (nodeId: string) => api.post<void>(`/api/nodes/${nodeId}/sync`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nodes'] })
      void queryClient.invalidateQueries({ queryKey: ['guests'] })
    },
  })
}
