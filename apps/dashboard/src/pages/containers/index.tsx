import { useState, useEffect } from 'react'
import { createRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { layoutRoute } from '@/layout-route'
import { useNodes } from '@/hooks/useNodes'
import { useGuests } from '@/hooks/useGuests'
import { useProvisioningJobs, useProvisioningLiveUpdates } from '@/hooks/useProvisioning'
import { useDeployTargets, useDeployJobs, useTriggerDeploy, useCancelDeployJob } from '@/hooks/useDeploy'
import { useDeployLogs } from '@/hooks/useDeployLogs'
import { GuestTable } from '@/components/guests/GuestTable'
import { ProvisioningJobRow } from '@/components/provisioning/ProvisioningJobRow'
import { JobStatusBadge } from '@/components/deploy/JobStatusBadge'
import { DeployLogViewer } from '@/components/deploy/DeployLogViewer'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { LxcForm } from '@/pages/provision/LxcForm'
import { QemuForm } from '@/pages/provision/QemuForm'
import { DeployTargetForm } from '@/pages/containers/DeployTargetForm'
import { useAuthStore } from '@/stores/auth'
import { ws } from '@/lib/ws'
import { cn, formatRelative } from '@/lib/utils'
import { Plus, Server, GitBranch, Play, X, ChevronDown, ChevronRight } from 'lucide-react'
import type { DeployJob, DeployTarget } from '@ninja/types'

export const containersRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/containers',
  component: ContainersPage,
})

type GuestTypeTab = 'lxc' | 'qemu'

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return '—'
  const end = finishedAt ? new Date(finishedAt) : new Date()
  const secs = Math.round((end.getTime() - new Date(startedAt).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

function triggerLabel(trigger: DeployJob['trigger']): string {
  if (trigger.source === 'github_webhook') return 'GitHub'
  if (trigger.source === 'manual') return 'Manual'
  return trigger.source
}

// ── Per-row component manages expand/log state independently ─────────────────

interface DeployJobRowProps {
  job: DeployJob
  targets: DeployTarget[]
  canCancel: boolean
  onCancel: (jobId: string) => void
}

function DeployJobRow({ job, targets, canCancel, onCancel }: DeployJobRowProps) {
  const [expanded, setExpanded] = useState(false)
  const isLive = job.state === 'running' || job.state === 'dispatched'
  const { lines, isStreaming } = useDeployLogs(expanded ? job.id : '', expanded && isLive)

  const target = targets.find(t => t.id === job.targetId)
  const targetLabel = target
    ? `${target.repository}@${target.branch}`
    : job.targetId.slice(0, 8)

  const isActive = job.state === 'queued' || job.state === 'dispatched' || job.state === 'running'

  return (
    <>
      <tr
        className="border-b border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-2.5 w-5">
          {expanded
            ? <ChevronDown size={13} className="text-zinc-400" />
            : <ChevronRight size={13} className="text-zinc-400" />
          }
        </td>
        <td className="px-4 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-300 max-w-xs truncate">
          {targetLabel}
        </td>
        <td className="px-4 py-2.5">
          <JobStatusBadge state={job.state} />
        </td>
        <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400 capitalize">
          {triggerLabel(job.trigger)}
        </td>
        <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
          {job.startedAt ? formatRelative(job.startedAt) : '—'}
        </td>
        <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {formatDuration(job.startedAt, job.finishedAt)}
        </td>
        <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
          {canCancel && isActive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-zinc-400 hover:text-red-500"
              aria-label="Cancel job"
              onClick={() => onCancel(job.id)}
            >
              <X size={12} />
            </Button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-950/50">
          <td colSpan={7} className="p-0">
            <div className="h-56">
              <DeployLogViewer lines={lines} isStreaming={isStreaming} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function ContainersPage() {
  const { data: nodes, isLoading: nodesLoading } = useNodes()
  const [selectedNodeId, setSelectedNodeId] = useState<string>('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [newGuestType, setNewGuestType] = useState<GuestTypeTab>('lxc')
  const [deploySheetOpen, setDeploySheetOpen] = useState(false)
  const [triggerFormOpen, setTriggerFormOpen] = useState(false)
  const [triggerTargetId, setTriggerTargetId] = useState('')

  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const canOperate = useAuthStore(s => {
    const role = s.user?.role
    return role === 'admin' || role === 'operator'
  })
  const canPower = canOperate

  const queryClient = useQueryClient()

  useProvisioningLiveUpdates()

  // Live deploy job updates via WebSocket
  useEffect(() => {
    const unsub = ws.on('deploy_update', () => {
      void queryClient.invalidateQueries({ queryKey: ['deploy-jobs'] })
    })
    return unsub
  }, [queryClient])

  const activeNodeId = selectedNodeId || nodes?.[0]?.id || ''

  const { data: guests, isLoading: guestsLoading } = useGuests(activeNodeId)
  const { data: provJobs } = useProvisioningJobs(activeNodeId || undefined)

  const { data: allTargets } = useDeployTargets()
  const { data: allJobs, isLoading: jobsLoading } = useDeployJobs({ limit: 20 })

  const { mutate: triggerDeploy, isPending: triggering } = useTriggerDeploy()
  const { mutate: cancelJob } = useCancelDeployJob()

  const activeNode = nodes?.find(n => n.id === activeNodeId)

  // Filter targets and jobs to the active node
  const nodeTargets = (allTargets ?? []).filter(t => t.nodeId === activeNodeId)
  const nodeTargetIds = new Set(nodeTargets.map(t => t.id))
  const nodeJobs = (allJobs ?? []).filter(j => nodeTargetIds.has(j.targetId))

  function openSheet(type: GuestTypeTab) {
    setNewGuestType(type)
    setSheetOpen(true)
  }

  function handleTrigger(e: React.FormEvent) {
    e.preventDefault()
    if (!triggerTargetId) return
    triggerDeploy(triggerTargetId, {
      onSuccess: () => {
        setTriggerFormOpen(false)
        setTriggerTargetId('')
      },
    })
  }

  function handleCancel(jobId: string) {
    cancelJob(jobId)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Containers &amp; VMs</h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Manage guests across your Proxmox nodes.
          </p>
        </div>
        {isAdmin && activeNodeId && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setDeploySheetOpen(true)}>
              <GitBranch size={14} />
              New Deploy Target
            </Button>
            <Button size="sm" variant="outline" onClick={() => openSheet('qemu')}>
              <Plus size={14} />
              New VM
            </Button>
            <Button size="sm" onClick={() => openSheet('lxc')}>
              <Plus size={14} />
              New Container
            </Button>
          </div>
        )}
      </div>

      {/* Node tabs */}
      {nodesLoading ? (
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-28" />)}
        </div>
      ) : !nodes || nodes.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-10 text-center">
          <Server size={24} className="mx-auto mb-2 text-zinc-400" />
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No nodes registered</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Add a Proxmox node on the Nodes page first.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-1 w-fit">
            {nodes.map(node => (
              <button
                key={node.id}
                onClick={() => setSelectedNodeId(node.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeNodeId === node.id
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100',
                )}
              >
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  node.status === 'online' ? 'bg-green-400' : 'bg-zinc-400',
                  activeNodeId === node.id && 'bg-white/70',
                )} />
                {node.name}
              </button>
            ))}
          </div>

          {/* Guest table */}
          <GuestTable
            guests={guests ?? []}
            nodeId={activeNodeId}
            isLoading={guestsLoading}
            canPower={canPower}
            isAdmin={isAdmin}
          />

          {/* Deploy jobs for this node */}
          {(jobsLoading || nodeJobs.length > 0 || nodeTargets.length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Deploy Jobs
                  {activeNode && (
                    <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                      — {activeNode.name}
                    </span>
                  )}
                </h3>
                {canOperate && nodeTargets.length > 0 && (
                  triggerFormOpen ? (
                    <form
                      onSubmit={e => void handleTrigger(e)}
                      className="flex items-center gap-2"
                      onClick={e => e.stopPropagation()}
                    >
                      <Select
                        value={triggerTargetId}
                        onChange={e => setTriggerTargetId(e.target.value)}
                        className="h-7 text-xs w-52"
                      >
                        <option value="">Select target…</option>
                        {nodeTargets.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.repository}@{t.branch}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" size="sm" disabled={!triggerTargetId || triggering}>
                        <Play size={12} />
                        {triggering ? 'Triggering…' : 'Deploy'}
                      </Button>
                      <button
                        type="button"
                        onClick={() => { setTriggerFormOpen(false); setTriggerTargetId('') }}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTriggerFormOpen(true)}
                    >
                      <Play size={12} />
                      Trigger deploy
                    </Button>
                  )
                )}
              </div>

              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                      <th className="px-4 py-2.5 w-5" />
                      {['Target', 'State', 'Triggered by', 'Started', 'Duration', ''].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jobsLoading
                      ? Array.from({ length: 3 }).map((_, i) => (
                          <tr key={i} className="border-b border-zinc-200 dark:border-zinc-700">
                            {Array.from({ length: 7 }).map((_, j) => (
                              <td key={j} className="px-4 py-3">
                                <Skeleton className="h-4 w-full" />
                              </td>
                            ))}
                          </tr>
                        ))
                      : nodeJobs.length === 0
                      ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                              No deploy jobs yet
                            </td>
                          </tr>
                        )
                      : nodeJobs.map(job => (
                          <DeployJobRow
                            key={job.id}
                            job={job}
                            targets={nodeTargets}
                            canCancel={canOperate}
                            onCancel={handleCancel}
                          />
                        ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Provisioning jobs for this node */}
          {provJobs && provJobs.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
                Recent Provisioning Jobs
                {activeNode && (
                  <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                    — {activeNode.name}
                  </span>
                )}
              </h3>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                      {['ID', 'Name', 'Type', 'VMID', 'State', 'Created', ''].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {provJobs.map(job => (
                      <ProvisioningJobRow key={job.id} job={job} isAdmin={isAdmin} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Deploy target sheet */}
      <Sheet
        open={deploySheetOpen}
        onClose={() => setDeploySheetOpen(false)}
        title="New Deploy Target"
        description={`Map a repository branch to a container on ${activeNode?.name ?? 'a node'} for automated deploys.`}
        className="max-w-2xl"
      >
        {nodes && (
          <DeployTargetForm
            nodes={nodes}
            defaultNodeId={activeNodeId}
            onSuccess={() => setDeploySheetOpen(false)}
          />
        )}
      </Sheet>

      {/* Provision sheet */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={newGuestType === 'lxc' ? 'New LXC Container' : 'New QEMU VM'}
        description={`Provision a new ${newGuestType === 'lxc' ? 'LXC container' : 'QEMU virtual machine'} on ${activeNode?.name ?? 'a node'}.`}
        className="max-w-2xl"
      >
        <div className="mb-6">
          <div className="flex gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-1 w-fit">
            {(['lxc', 'qemu'] as const).map(type => (
              <button
                key={type}
                onClick={() => setNewGuestType(type)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                  newGuestType === type
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100',
                )}
              >
                {type === 'lxc' ? 'LXC Container' : 'QEMU VM'}
              </button>
            ))}
          </div>
        </div>

        {newGuestType === 'lxc' ? (
          <LxcForm defaultNodeId={activeNodeId} onSuccess={() => setSheetOpen(false)} />
        ) : (
          <QemuForm defaultNodeId={activeNodeId} onSuccess={() => setSheetOpen(false)} />
        )}
      </Sheet>
    </div>
  )
}
