import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import { layoutRoute } from '@/layout-route'
import { useNodes } from '@/hooks/useNodes'
import { useGuests } from '@/hooks/useGuests'
import { useProvisioningJobs, useProvisioningLiveUpdates, useDeleteProvisioningJob } from '@/hooks/useProvisioning'
import { GuestTable } from '@/components/guests/GuestTable'
import { ProvisioningJobRow } from '@/components/provisioning/ProvisioningJobRow'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LxcForm } from '@/pages/provision/LxcForm'
import { QemuForm } from '@/pages/provision/QemuForm'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'
import { Plus, Server } from 'lucide-react'

export const containersRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/containers',
  component: ContainersPage,
})

type GuestTypeTab = 'lxc' | 'qemu'

function ContainersPage() {
  const { data: nodes, isLoading: nodesLoading } = useNodes()
  const [selectedNodeId, setSelectedNodeId] = useState<string>('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [newGuestType, setNewGuestType] = useState<GuestTypeTab>('lxc')

  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const canPower = useAuthStore(s => {
    const role = s.user?.role
    return role === 'admin' || role === 'operator'
  })

  useProvisioningLiveUpdates()

  // Default to first node when loaded
  const activeNodeId = selectedNodeId || nodes?.[0]?.id || ''

  const { data: guests, isLoading: guestsLoading } = useGuests(activeNodeId)
  const { data: jobs } = useProvisioningJobs(activeNodeId || undefined)

  const activeNode = nodes?.find(n => n.id === activeNodeId)

  function openSheet(type: GuestTypeTab) {
    setNewGuestType(type)
    setSheetOpen(true)
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
          />

          {/* Provisioning jobs for this node */}
          {jobs && jobs.length > 0 && (
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
                    {jobs.map(job => (
                      <ProvisioningJobRow key={job.id} job={job} isAdmin={isAdmin} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Provision sheet */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={newGuestType === 'lxc' ? 'New LXC Container' : 'New QEMU VM'}
        description={`Provision a new ${newGuestType === 'lxc' ? 'LXC container' : 'QEMU virtual machine'} on ${activeNode?.name ?? 'a node'}.`}
        className="max-w-2xl"
      >
        {/* Type toggle inside sheet */}
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
