import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import { layoutRoute } from '@/layout-route'
import { LxcForm } from './LxcForm'
import { QemuForm } from './QemuForm'
import { ProvisioningJobRow } from '@/components/provisioning/ProvisioningJobRow'
import { useProvisioningJobs, useProvisioningLiveUpdates } from '@/hooks/useProvisioning'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'

export const provisionRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/provision',
  component: ProvisionPage,
})

type GuestType = 'lxc' | 'qemu'

function ProvisionPage() {
  const [guestType, setGuestType] = useState<GuestType>('lxc')
  const { data: jobs } = useProvisioningJobs()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')

  useProvisioningLiveUpdates()

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Provision Guest</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Create a new LXC container or QEMU VM on a registered Proxmox node.
        </p>
      </div>

      {/* Guest type selector */}
      <div className="flex gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-1 w-fit">
        {(['lxc', 'qemu'] as const).map(type => (
          <button
            key={type}
            onClick={() => setGuestType(type)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              guestType === type
                ? 'bg-blue-600 text-white'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100',
            )}
          >
            {type === 'lxc' ? 'LXC Container' : 'QEMU VM'}
          </button>
        ))}
      </div>

      {/* Active form */}
      <div>
        {guestType === 'lxc' ? <LxcForm /> : <QemuForm />}
      </div>

      {/* Job history */}
      <div>
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          Recent Provisioning Jobs
        </h3>
        {!jobs || jobs.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No provisioning jobs yet.</p>
        ) : (
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
        )}
      </div>
    </div>
  )
}
