import { createRoute, Link } from '@tanstack/react-router'
import { layoutRoute } from '@/layout-route'
import { useDeployJob, useCancelDeployJob } from '@/hooks/useDeploy'
import { useDeployLogs } from '@/hooks/useDeployLogs'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useQueryClient } from '@tanstack/react-query'
import { JobStatusBadge } from '@/components/deploy/JobStatusBadge'
import { DeployLogViewer } from '@/components/deploy/DeployLogViewer'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/toast'
import { formatDatetime, formatRelative, truncate } from '@/lib/utils'
import { ArrowLeft } from 'lucide-react'

export const jobDetailRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/deploy/jobs/$jobId',
  component: JobDetailPage,
})

const LIVE_STATES = new Set(['queued', 'dispatched', 'running'])

function JobDetailPage() {
  const { jobId } = jobDetailRoute.useParams()
  const queryClient = useQueryClient()
  const { data: job, isLoading, error, refetch } = useDeployJob(jobId)
  const { user } = useAuthStore()
  const { toast } = useToast()
  const { mutate: cancel, isPending: cancelling } = useCancelDeployJob()

  const isLive = job ? LIVE_STATES.has(job.state) : false
  const { lines, isStreaming } = useDeployLogs(jobId, isLive)

  // Update job state in real-time
  useWebSocket('deploy_update', (msg) => {
    if (msg.type === 'deploy_update' && msg.data.id === jobId) {
      void queryClient.invalidateQueries({ queryKey: ['deploy-jobs', jobId] })
    }
  })

  const canCancel = (user?.role === 'admin' || user?.role === 'operator') && isLive

  function handleCancel() {
    if (!confirm('Cancel this deploy job?')) return
    cancel(jobId, {
      onSuccess: () => toast({ title: 'Job cancelled', variant: 'success' }),
      onError: (err) =>
        toast({ title: 'Failed to cancel job', description: String(err), variant: 'error' }),
    })
  }

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />

  // Derive repo/branch from target or trigger
  const repoLabel = job
    ? job.target
      ? `${job.target.repository}@${job.target.branch}`
      : job.trigger.source === 'github_webhook'
      ? `${job.trigger.repository}@${job.trigger.branch}`
      : '—'
    : '—'

  return (
    <div className="space-y-4">
      <Link
        to="/deploy/jobs"
        className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        <ArrowLeft size={14} />
        Back to jobs
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6" style={{ height: 'calc(100vh - 220px)' }}>
        {/* Left: metadata */}
        <div className="lg:col-span-2 space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : job ? (
            <>
              <div className="flex items-center gap-2">
                <JobStatusBadge state={job.state} />
                {canCancel && (
                  <Button size="sm" variant="destructive" onClick={handleCancel} disabled={cancelling}>
                    {cancelling ? 'Cancelling…' : 'Cancel'}
                  </Button>
                )}
              </div>

              <dl className="space-y-2.5 text-sm">
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">Target</dt>
                  <dd className="font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">{repoLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">Trigger</dt>
                  <dd className="text-zinc-900 dark:text-zinc-100 mt-0.5 capitalize">
                    {job.trigger.source.replace('_', ' ')}
                    {(job.trigger.source === 'manual' || job.trigger.source === 'cli') && (
                      <span className="text-zinc-500"> by {job.trigger.username}</span>
                    )}
                  </dd>
                </div>
                {job.trigger.source === 'github_webhook' && (
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">Commit</dt>
                    <dd className="font-mono text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                      {truncate(job.trigger.commitSha, 12)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">Queued</dt>
                  <dd className="text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {formatDatetime(job.queuedAt)}
                  </dd>
                </div>
                {job.startedAt && (
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">Started</dt>
                    <dd className="text-zinc-900 dark:text-zinc-100 mt-0.5">
                      {formatRelative(job.startedAt)}
                    </dd>
                  </div>
                )}
                {job.finishedAt && job.startedAt && (
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">Duration</dt>
                    <dd className="font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">
                      {Math.round(
                        (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000,
                      )}s
                    </dd>
                  </div>
                )}
                {job.exitCode !== null && (
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">Exit code</dt>
                    <dd className={`font-mono mt-0.5 ${job.exitCode === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {job.exitCode}
                    </dd>
                  </div>
                )}
                {job.errorMessage && (
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">Error</dt>
                    <dd className="text-red-600 dark:text-red-400 mt-0.5 text-xs">{job.errorMessage}</dd>
                  </div>
                )}
              </dl>
            </>
          ) : null}
        </div>

        {/* Right: logs */}
        <div className="lg:col-span-3 flex flex-col min-h-0">
          <DeployLogViewer lines={lines} isStreaming={isStreaming} />
        </div>
      </div>
    </div>
  )
}
