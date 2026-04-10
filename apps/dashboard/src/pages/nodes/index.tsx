import { createRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { layoutRoute } from '@/layout-route'
import { useNodes, useCreateNode, useUpdateNode, useDeleteNode, useSyncNode, useTestNodeConnection } from '@/hooks/useNodes'
import { useNodeMetrics } from '@/hooks/useMetrics'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { NodeStatusBadge } from '@/components/nodes/NodeStatusBadge'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, RefreshCw, Trash2, Pencil, CheckCircle, XCircle } from 'lucide-react'
import { formatRelative } from '@/lib/utils'
import type { ProxmoxNode } from '@ninja/types'

export const nodesRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/nodes',
  component: NodesPage,
})

interface NodeFormData {
  name: string
  host: string
  port: string
  tokenId: string
  tokenSecret: string
}

function initialForm(): NodeFormData {
  return { name: '', host: '', port: '8006', tokenId: '', tokenSecret: '' }
}

function NodesPage() {
  const { data: nodes, isLoading, error, refetch } = useNodes()
  const { mutate: createNode, isPending: creating } = useCreateNode()
  const { mutate: updateNode, isPending: updating } = useUpdateNode()
  const { mutate: deleteNode } = useDeleteNode()
  const { mutate: syncNode } = useSyncNode()
  const { mutate: testConnection, isPending: testing } = useTestNodeConnection()
  const { user } = useAuthStore()
  const { toast } = useToast()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingNode, setEditingNode] = useState<ProxmoxNode | null>(null)
  const [form, setForm] = useState<NodeFormData>(initialForm)
  const [testResult, setTestResult] = useState<boolean | null>(null)

  const isAdmin = user?.role === 'admin'

  function set(field: keyof NodeFormData) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }))
      setTestResult(null)
    }
  }

  function handleTest() {
    testConnection(
      {
        name: form.name || 'test',
        host: form.host,
        port: Number(form.port) || 8006,
        tokenId: form.tokenId,
        tokenSecret: form.tokenSecret,
      },
      {
        onSuccess: () => setTestResult(true),
        onError: () => setTestResult(false),
      },
    )
  }

  function openEdit(node: ProxmoxNode) {
    setEditingNode(node)
    setForm({ name: node.name, host: node.host, port: String(node.port), tokenId: node.tokenId, tokenSecret: '' })
    setTestResult(null)
    setSheetOpen(true)
  }

  function closeSheet() {
    setSheetOpen(false)
    setEditingNode(null)
    setForm(initialForm())
    setTestResult(null)
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    createNode(
      {
        name: form.name,
        host: form.host,
        port: Number(form.port) || 8006,
        tokenId: form.tokenId,
        tokenSecret: form.tokenSecret,
      },
      {
        onSuccess: () => {
          toast({ title: 'Node added', variant: 'success' })
          closeSheet()
        },
        onError: (err) =>
          toast({ title: 'Failed to add node', description: String(err), variant: 'error' }),
      },
    )
  }

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!editingNode) return
    const input: Record<string, string | number> = {}
    if (form.name !== editingNode.name) input.name = form.name
    if (form.host !== editingNode.host) input.host = form.host
    if (Number(form.port) !== editingNode.port) input.port = Number(form.port) || 8006
    if (form.tokenId !== editingNode.tokenId) input.tokenId = form.tokenId
    if (form.tokenSecret) input.tokenSecret = form.tokenSecret
    updateNode(
      { nodeId: editingNode.id, input },
      {
        onSuccess: () => {
          toast({ title: 'Node updated', variant: 'success' })
          closeSheet()
        },
        onError: (err) =>
          toast({ title: 'Failed to update node', description: String(err), variant: 'error' }),
      },
    )
  }

  function handleDelete(node: ProxmoxNode) {
    if (!confirm(`Delete node "${node.name}"?`)) return
    deleteNode(node.id, {
      onSuccess: () => toast({ title: 'Node deleted', variant: 'success' }),
      onError: (err) =>
        toast({ title: 'Failed to delete node', description: String(err), variant: 'error' }),
    })
  }

  function handleSync(nodeId: string) {
    syncNode(nodeId, {
      onSuccess: () => toast({ title: 'Sync started', variant: 'success' }),
      onError: (err) =>
        toast({ title: 'Sync failed', description: String(err), variant: 'error' }),
    })
  }

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {nodes?.length ?? '—'} node{nodes?.length !== 1 ? 's' : ''} registered
        </p>
        {isAdmin && (
          <Button size="sm" onClick={() => { setEditingNode(null); setSheetOpen(true) }}>
            <Plus size={14} />
            Add node
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Name</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Host</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Status</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">CPU</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Memory</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Last synced</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : nodes?.map((node) => (
                  <NodeRow
                    key={node.id}
                    node={node}
                    isAdmin={isAdmin}
                    onSync={() => handleSync(node.id)}
                    onEdit={() => openEdit(node)}
                    onDelete={() => handleDelete(node)}
                  />
                ))}
            {!isLoading && (!nodes || nodes.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No nodes yet</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Add your first Proxmox node to get started.
                  </p>
                  {isAdmin && (
                    <Button size="sm" className="mt-3" onClick={() => setSheetOpen(true)}>
                      <Plus size={14} />
                      Add node
                    </Button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet
        open={sheetOpen}
        onClose={closeSheet}
        title={editingNode ? `Edit ${editingNode.name}` : 'Add Node'}
        description={editingNode ? 'Update connection details for this node.' : 'Connect a Proxmox node to ninja-ops.'}
      >
        <form onSubmit={(e) => void (editingNode ? handleUpdate(e) : handleCreate(e))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={form.name} onChange={set('name')} placeholder="pve-01" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="host">Host / IP</Label>
            <Input id="host" value={form.host} onChange={set('host')} placeholder="192.168.1.100" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="port">Port</Label>
            <Input id="port" type="number" value={form.port} onChange={set('port')} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tokenId">Token ID</Label>
            <Input id="tokenId" value={form.tokenId} onChange={set('tokenId')} placeholder="user@pam!mytoken" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tokenSecret">
              Token Secret{editingNode && <span className="ml-1 text-zinc-400 font-normal">(leave blank to keep current)</span>}
            </Label>
            <Input
              id="tokenSecret"
              type="password"
              value={form.tokenSecret}
              onChange={set('tokenSecret')}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required={!editingNode}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            {testResult === true && (
              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <CheckCircle size={14} /> Connected
              </span>
            )}
            {testResult === false && (
              <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                <XCircle size={14} /> Failed
              </span>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating || updating}>
              {editingNode ? (updating ? 'Saving…' : 'Save changes') : (creating ? 'Adding…' : 'Add node')}
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  )
}

// ─── Node Row ─────────────────────────────────────────────────────────────────

function NodeRow({
  node,
  isAdmin,
  onSync,
  onEdit,
  onDelete,
}: {
  node: ProxmoxNode
  isAdmin: boolean
  onSync: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { latest } = useNodeMetrics(node.id)
  const cpuPct = latest ? `${Math.round(latest.cpu * 100)}%` : '—'
  const memPct =
    latest && latest.maxmem > 0
      ? `${Math.round((latest.mem / latest.maxmem) * 100)}%`
      : '—'

  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
      <td className="px-4 py-2.5 font-medium text-sm text-zinc-900 dark:text-zinc-100">{node.name}</td>
      <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {node.host}:{node.port}
      </td>
      <td className="px-4 py-2.5">
        <NodeStatusBadge status={node.status} />
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">{cpuPct}</td>
      <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">{memPct}</td>
      <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
        {formatRelative(node.updatedAt)}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onSync} aria-label="Sync">
            <RefreshCw size={14} />
          </Button>
          {isAdmin && (
            <>
              <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit">
                <Pencil size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
                className="text-red-500 hover:text-red-600"
                aria-label="Delete"
              >
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}
