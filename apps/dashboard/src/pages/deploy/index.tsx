import { createRoute } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { layoutRoute } from '@/layout-route'
import { useDeployTargets, useDeleteDeployTarget, useTriggerDeploy, useUpdateDeployTarget } from '@/hooks/useDeploy'
import { useNodes } from '@/hooks/useNodes'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/sheet'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Trash2, Play, Edit } from 'lucide-react'
import type { DeployTarget } from '@ninja/types'

export const deployRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/deploy',
  component: DeployPage,
})

function DeployPage() {
  const { data: targets, isLoading, error, refetch } = useDeployTargets()
  const { data: nodes } = useNodes()
  const { mutate: deleteTarget } = useDeleteDeployTarget()
  const { mutate: trigger } = useTriggerDeploy()
  const { mutate: updateTarget, isPending: updating } = useUpdateDeployTarget()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const [editTarget, setEditTarget] = useState<DeployTarget | null>(null)
  const [editForm, setEditForm] = useState<Partial<Record<string, string>>>({})

  const isAdmin = user?.role === 'admin'
  const canDeploy = user?.role === 'admin' || user?.role === 'operator'

  function handleTrigger(id: string) {
    trigger(id, {
      onSuccess: (job) => {
        toast({ title: 'Deploy triggered', description: `Job ${job.id.slice(0, 8)}`, variant: 'success' })
      },
      onError: (err) =>
        toast({ title: 'Failed to trigger deploy', description: String(err), variant: 'error' }),
    })
  }

  function handleDelete(t: DeployTarget) {
    if (!confirm(`Delete target "${t.repository}@${t.branch}"?`)) return
    deleteTarget(t.id, {
      onSuccess: () => toast({ title: 'Target deleted', variant: 'success' }),
      onError: (err) =>
        toast({ title: 'Failed to delete target', description: String(err), variant: 'error' }),
    })
  }

  function openEdit(t: DeployTarget) {
    setEditTarget(t)
    setEditForm({
      repository: t.repository,
      branch: t.branch,
      nodeId: t.nodeId,
      vmid: String(t.vmid),
      workingDirectory: t.workingDir,
      restartCommand: t.restartCommand,
      preDeployCommand: t.preDeployCommand ?? '',
      postDeployCommand: t.postDeployCommand ?? '',
      timeoutSeconds: String(t.timeoutSeconds),
    })
  }

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    updateTarget(
      {
        id: editTarget.id,
        input: {
          ...(editForm['branch'] ? { branch: editForm['branch'] } : {}),
          ...(editForm['workingDirectory'] ? { workingDirectory: editForm['workingDirectory'] } : {}),
          ...(editForm['restartCommand'] ? { restartCommand: editForm['restartCommand'] } : {}),
          ...(editForm['preDeployCommand'] ? { preDeployCommand: editForm['preDeployCommand'] } : {}),
          ...(editForm['postDeployCommand'] ? { postDeployCommand: editForm['postDeployCommand'] } : {}),
          ...(editForm['timeoutSeconds'] ? { timeoutSeconds: Number(editForm['timeoutSeconds']) } : {}),
        },
      },
      {
        onSuccess: () => {
          toast({ title: 'Target updated', variant: 'success' })
          setEditTarget(null)
        },
        onError: (err) =>
          toast({ title: 'Update failed', description: String(err), variant: 'error' }),
      },
    )
  }

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {targets?.length ?? '—'} target{targets?.length !== 1 ? 's' : ''}
        </p>
        {isAdmin && (
          <Link to="/deploy/targets/new">
            <Button size="sm">
              <Plus size={14} />
              New target
            </Button>
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Repository</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Branch</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Node</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">VMID</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Timeout</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : targets?.map((t) => {
                  const nodeName = nodes?.find((n) => n.id === t.nodeId)?.name ?? t.nodeId.slice(0, 8)
                  return (
                    <tr key={t.id} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-900 dark:text-zinc-100">{t.repository}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">{t.branch}</td>
                      <td className="px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300">{nodeName}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">{t.vmid}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">{t.timeoutSeconds}s</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          {canDeploy && (
                            <Button size="sm" variant="outline" onClick={() => handleTrigger(t.id)}>
                              <Play size={12} />
                              Deploy
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => openEdit(t)}>
                            <Edit size={14} />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-red-500 hover:text-red-600"
                              onClick={() => handleDelete(t)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
            {!isLoading && (!targets || targets.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No deploy targets</p>
                  {isAdmin && (
                    <Link to="/deploy/targets/new">
                      <Button size="sm" className="mt-3">
                        <Plus size={14} />
                        New target
                      </Button>
                    </Link>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Link to="/deploy/jobs">
          <Button variant="outline" size="sm">View all jobs →</Button>
        </Link>
      </div>

      {/* Edit sheet */}
      <Sheet
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Edit Deploy Target"
      >
        <form onSubmit={(e) => void handleUpdate(e)} className="space-y-4">
          {(['branch', 'workingDirectory', 'restartCommand', 'preDeployCommand', 'postDeployCommand'] as const).map((field) => (
            <div key={field} className="space-y-1.5">
              <Label>{field.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toUpperCase())}</Label>
              <Input
                value={editForm[field] ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, [field]: e.target.value }))}
              />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label>Timeout (seconds)</Label>
            <Input
              type="number"
              value={editForm['timeoutSeconds'] ?? '300'}
              onChange={(e) => setEditForm((f) => ({ ...f, timeoutSeconds: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button type="submit" disabled={updating}>{updating ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Sheet>
    </div>
  )
}
