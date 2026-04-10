import { createRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { layoutRoute } from '@/layout-route'
import { useDeployJobs, useDeployTargets } from '@/hooks/useDeploy'
import { JobStatusBadge } from '@/components/deploy/JobStatusBadge'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { Select } from '@/components/ui/select'
import { formatRelative, truncate } from '@/lib/utils'
import type { DeployState } from '@ninja/types'

export const deployJobsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/deploy/jobs',
  component: DeployJobsPage,
})

const STATES: Array<{ value: DeployState | ''; label: string }> = [
  { value: '', label: 'All states' },
  { value: 'queued', label: 'Queued' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
]

function DeployJobsPage() {
  const [targetId, setTargetId] = useState('')
  const [state, setState] = useState<DeployState | ''>('')

  const { data: targets } = useDeployTargets()
  const filters = {
    ...(targetId ? { targetId } : {}),
    ...(state ? { state } : {}),
    limit: 50,
  }
  const { data: jobs, isLoading, error, refetch } = useDeployJobs(filters)

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-56">
          <option value="">All targets</option>
          {targets?.map((t) => (
            <option key={t.id} value={t.id}>{truncate(`${t.repository}@${t.branch}`, 40)}</option>
          ))}
        </Select>
        <Select value={state} onChange={(e) => setState(e.target.value as DeployState | '')} className="w-36">
          {STATES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Job ID</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Target</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">State</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Trigger</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Queued</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Duration</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : jobs?.map((job) => {
                  const repoLabel = job.target
                    ? `${job.target.repository}@${job.target.branch}`
                    : job.trigger.source === 'github_webhook'
                    ? `${job.trigger.repository}@${job.trigger.branch}`
                    : job.targetId.slice(0, 8)

                  const duration =
                    job.startedAt && job.finishedAt
                      ? Math.round(
                          (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000,
                        ) + 's'
                      : job.startedAt && !job.finishedAt
                      ? 'Running'
                      : '—'

                  return (
                    <tr
                      key={job.id}
                      className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        <Link to="/deploy/jobs/$jobId" params={{ jobId: job.id }} className="hover:underline">
                          {job.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                        <Link to="/deploy/jobs/$jobId" params={{ jobId: job.id }}>
                          {truncate(repoLabel, 40)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <JobStatusBadge state={job.state} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400 capitalize">
                        {job.trigger.source.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {formatRelative(job.queuedAt)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {duration}
                      </td>
                    </tr>
                  )
                })}
            {!isLoading && (!jobs || jobs.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No jobs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
