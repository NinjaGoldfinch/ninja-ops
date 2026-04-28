import { useState, useEffect, useRef } from 'react'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useServiceRedeployJob, useCancelServiceRedeploy, useServiceRedeployJobs } from '@/hooks/useServiceRedeploy'
import { useToast } from '@/components/ui/toast'
import type { ServiceRedeployJob, ServiceName } from '@ninja/types'
import { cn, formatRelative } from '@/lib/utils'
import { Clock, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import type { StoredLogEntry } from '@/hooks/useDiagnostics'

const STATE_CONFIG: Record<ServiceRedeployJob['state'], { color: string; bg: string; label: string }> = {
  queued:    { color: 'text-yellow-400', bg: 'bg-yellow-900/30',  label: 'Queued'    },
  running:   { color: 'text-blue-400',   bg: 'bg-blue-900/30',    label: 'Running'   },
  success:   { color: 'text-green-400',  bg: 'bg-green-900/30',   label: 'Success'   },
  failed:    { color: 'text-red-400',    bg: 'bg-red-900/30',     label: 'Failed'    },
  cancelled: { color: 'text-zinc-500',   bg: 'bg-zinc-800/50',    label: 'Cancelled' },
}

function useDuration(startedAt: string | null, finishedAt: string | null): string | null {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!startedAt || finishedAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt, finishedAt])

  if (!startedAt) return null
  const ms = finishedAt
    ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    : now - new Date(startedAt).getTime()
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function TimelineRow({ label, time }: { label: string; time: string | null }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', time ? 'bg-zinc-400' : 'bg-zinc-700')} />
      <span className={time ? 'text-zinc-400' : 'text-zinc-600'}>{label}</span>
      {time && (
        <span className="text-zinc-600 ml-auto tabular-nums">{new Date(time).toLocaleString()}</span>
      )}
    </div>
  )
}

function ServiceRedeployLogs({ jobId, active }: { jobId: string; active: boolean }) {
  const { data: logs } = useQuery({
    queryKey: ['service-redeploy-logs', jobId],
    queryFn: () => api.get<StoredLogEntry[]>(`/api/services/redeploy-jobs/${jobId}/logs`),
    refetchInterval: active ? 2000 : false,
  })
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs?.length])

  return (
    <div className="rounded border border-zinc-700 bg-zinc-950 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-zinc-800">
        <span className="text-xs text-zinc-400">Output</span>
      </div>
      <div className="p-3 font-mono text-xs max-h-72 overflow-y-auto space-y-0.5">
        {!logs || logs.length === 0 ? (
          <span className="text-zinc-500">Waiting for output…</span>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className={entry.stream === 'stderr' ? 'text-red-400' : 'text-zinc-200'}>
              <span className="text-zinc-600 select-none mr-2">
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
              {entry.data.replace(/\n$/, '')}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

interface ServiceRedeployDrawerProps {
  service: ServiceName
  jobId: string | null
  onClose: () => void
}

export function ServiceRedeployDrawer({ service, jobId, onClose }: ServiceRedeployDrawerProps) {
  const { data: job, isLoading } = useServiceRedeployJob(jobId)
  const { data: allJobs } = useServiceRedeployJobs()
  const { mutate: cancelJob } = useCancelServiceRedeploy()
  const { toast } = useToast()
  const duration = useDuration(job?.startedAt ?? null, job?.finishedAt ?? null)

  const handleCancel = () => {
    if (!jobId) return
    cancelJob(jobId, {
      onSuccess: () => toast({ title: 'Redeploy cancelled', variant: 'success' }),
      onError: (err) => toast({ title: 'Cancel failed', description: String(err), variant: 'error' }),
    })
  }

  const queuePosition = job?.state === 'queued' && allJobs
    ? allJobs.filter(j => j.state === 'queued' && j.queuedAt < job.queuedAt).length + 1
    : null

  const recentJobs = allJobs?.filter(j => j.service === service && j.id !== jobId).slice(0, 5) ?? []
  const isActive = job?.state === 'running' || job?.state === 'queued'

  return (
    <Sheet
      open={true}
      onClose={onClose}
      title={`Redeploy — ${service}`}
      description={job?.targetVersion ? `target: ${job.targetVersion}` : 'latest'}
    >
      {isLoading || !job ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-4">

          {/* State pill + duration + cancel */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium',
                STATE_CONFIG[job.state].bg,
                STATE_CONFIG[job.state].color,
              )}>
                {job.state === 'running' && <Loader2 size={11} className="animate-spin" />}
                {STATE_CONFIG[job.state].label}
              </span>
              {duration && (
                <span className="text-xs text-zinc-500 flex items-center gap-1">
                  <Clock size={11} />
                  {duration}
                </span>
              )}
            </div>
            {job.state === 'queued' && (
              <Button variant="ghost" size="sm" onClick={handleCancel}>Cancel</Button>
            )}
          </div>

          {/* Queue position */}
          {queuePosition !== null && (
            <div className="rounded bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
              Position{' '}
              <span className="font-medium text-zinc-200">{queuePosition}</span>
              {' '}in queue
            </div>
          )}

          {/* Error */}
          {job.errorMessage && (
            <div className="rounded bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-400 font-mono">
              {job.errorMessage}
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-2">
            <TimelineRow label="Queued"   time={job.queuedAt} />
            <TimelineRow label="Started"  time={job.startedAt} />
            <TimelineRow label="Finished" time={job.finishedAt} />
          </div>

          {/* Logs */}
          {(job.state === 'running' || job.state === 'success' || job.state === 'failed') && (
            <ServiceRedeployLogs jobId={job.id} active={isActive} />
          )}

          {/* History */}
          {recentJobs.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">History</p>
              <div className="rounded border border-zinc-800 divide-y divide-zinc-800">
                {recentJobs.map(j => (
                  <div key={j.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className={STATE_CONFIG[j.state].color}>{STATE_CONFIG[j.state].label}</span>
                    <span className="text-zinc-400 font-mono text-xs">{j.targetVersion ?? 'latest'}</span>
                    <span className="text-zinc-600 tabular-nums">{formatRelative(j.queuedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </Sheet>
  )
}
