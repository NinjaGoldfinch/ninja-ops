import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import { layoutRoute } from '@/layout-route'
import { useServiceVersions, useServiceRedeployJobs, useServiceRedeployLiveUpdates } from '@/hooks/useServiceRedeploy'
import { ServiceVersionCard } from '@/components/services/ServiceVersionCard'
import { ServiceRedeployDrawer } from '@/components/services/ServiceRedeployDrawer'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/stores/auth'
import { cn, formatRelative } from '@/lib/utils'
import type { ServiceRedeployJob, ServiceName } from '@ninja/types'

export const servicesRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/services',
  component: ServicesPage,
})

const STATE_COLORS: Record<ServiceRedeployJob['state'], string> = {
  queued:    'text-yellow-400',
  running:   'text-blue-400',
  success:   'text-green-400',
  failed:    'text-red-400',
  cancelled: 'text-zinc-500',
}

function ServicesPage() {
  const { data: versions, isLoading, error, refetch } = useServiceVersions()
  const { data: jobs } = useServiceRedeployJobs()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [drawerService, setDrawerService] = useState<ServiceName | null>(null)
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null)

  useServiceRedeployLiveUpdates()

  const activeJobs = jobs?.filter(j => j.state === 'queued' || j.state === 'running') ?? []
  const getActiveJob = (service: ServiceName) => activeJobs.find(j => j.service === service)

  const handleJobCreated = (service: ServiceName, jobId: string) => {
    setDrawerService(service)
    setDrawerJobId(jobId)
  }

  const handleJobRowClick = (job: ServiceRedeployJob) => {
    setDrawerService(job.service)
    setDrawerJobId(job.id)
  }

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Services</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Version status and redeployment for platform services
        </p>
      </div>

      {/* Version cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {isLoading ? (
          <>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </>
        ) : versions ? (
          (['control-plane', 'dashboard'] as const).map(service => (
            <ServiceVersionCard
              key={service}
              version={versions[service]}
              activeJob={getActiveJob(service)}
              onJobCreated={(jobId) => isAdmin && handleJobCreated(service, jobId)}
            />
          ))
        ) : null}
      </div>

      {/* Redeploy job history */}
      {isAdmin && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Recent Redeploy Jobs
          </h2>
          {!jobs || jobs.length === 0 ? (
            <p className="text-sm text-zinc-500">No redeploy jobs yet.</p>
          ) : (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Service</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Version</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">State</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {jobs.slice(0, 20).map(job => (
                    <tr
                      key={job.id}
                      onClick={() => handleJobRowClick(job)}
                      className={cn(
                        'cursor-pointer transition-colors',
                        'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                        {job.service}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                        {job.targetVersion ? `v${job.targetVersion.replace(/^v/, '')}` : 'latest'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs font-medium', STATE_COLORS[job.state])}>
                          {job.state.charAt(0).toUpperCase() + job.state.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500 tabular-nums">
                        {job.startedAt ? formatRelative(job.startedAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {drawerService && drawerJobId && (
        <ServiceRedeployDrawer
          service={drawerService}
          jobId={drawerJobId}
          onClose={() => { setDrawerService(null); setDrawerJobId(null) }}
        />
      )}
    </div>
  )
}
