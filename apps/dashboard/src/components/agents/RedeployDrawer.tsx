import { useState, useEffect, useRef } from 'react'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useRedeployJob, useCancelRedeploy, useRedeployJobs, useBundleInfo } from '@/hooks/useAgentRedeploy'
import { useJobSessions, useJobSessionLogs } from '@/hooks/useDiagnostics'
import { useToast } from '@/components/ui/toast'
import type { Agent, AgentRedeployJob } from '@ninja/types'
import { cn, formatRelative } from '@/lib/utils'
import { Clock, Loader2 } from 'lucide-react'

interface RedeployDrawerProps {
  agent: Agent
  jobId: string | null
  onClose: () => void
}

const STATE_CONFIG: Record<AgentRedeployJob['state'], { color: string; bg: string; label: string }> = {
  queued:    { color: 'text-zinc-400',  bg: 'bg-zinc-800',      label: 'Queued'    },
  running:   { color: 'text-blue-400',  bg: 'bg-blue-900/30',   label: 'Running'   },
  success:   { color: 'text-green-400', bg: 'bg-green-900/30',  label: 'Success'   },
  failed:    { color: 'text-red-400',   bg: 'bg-red-900/30',    label: 'Failed'    },
  cancelled: { color: 'text-zinc-500',  bg: 'bg-zinc-800/50',   label: 'Cancelled' },
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

function RedeployLogs({ jobId }: { jobId: string }) {
  const { data: sessions } = useJobSessions('agent_redeploy', jobId, true)
  const sessionId = sessions?.[0]?.sessionId ?? null
  const { data: logs } = useJobSessionLogs(sessionId, true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs?.length])

  if (!sessionId) {
    return <p className="text-xs text-zinc-500 italic">Waiting for job to start…</p>
  }

  return (
    <div className="rounded border border-zinc-700 bg-zinc-950 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-xs text-zinc-400">Output</span>
        <span className="text-xs font-mono text-zinc-600">{sessionId.slice(0, 8)}</span>
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

export function RedeployDrawer({ agent, jobId, onClose }: RedeployDrawerProps) {
  const { data: job, isLoading } = useRedeployJob(jobId)
  const { data: allJobs } = useRedeployJobs()
  const { data: agentJobs } = useRedeployJobs(agent.id)
  const { data: bundleInfo } = useBundleInfo()
  const { mutate: cancelJob } = useCancelRedeploy()
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

  const expectedHash = bundleInfo
    ? (agent.kind === 'log' ? bundleInfo.logAgentHash : bundleInfo.deployAgentHash)
    : null

  const recentJobs = agentJobs?.filter(j => j.id !== jobId).slice(0, 5) ?? []

  return (
    <Sheet
      open={true}
      onClose={onClose}
      title={`Redeploy — ${agent.hostname}:${agent.kind}`}
      description={`vmid ${agent.vmid}`}
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
              {queuePosition > 1 && (
                <span className="text-zinc-500">
                  {' '}·{' '}{queuePosition - 1} job{queuePosition - 1 !== 1 ? 's' : ''} ahead
                </span>
              )}
            </div>
          )}

          {/* Version info */}
          {expectedHash && (
            <div className="rounded border border-zinc-800 divide-y divide-zinc-800 text-xs">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-zinc-500">Current</span>
                <span className="font-mono text-zinc-400">{agent.bundleHash.slice(0, 12)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-zinc-500">Target</span>
                <span className={cn(
                  'font-mono',
                  expectedHash === agent.bundleHash ? 'text-zinc-400' : 'text-blue-400',
                )}>
                  {expectedHash.slice(0, 12)}
                </span>
              </div>
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
            <RedeployLogs jobId={job.id} />
          )}

          {/* Recent history for this agent */}
          {recentJobs.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">History</p>
              <div className="rounded border border-zinc-800 divide-y divide-zinc-800">
                {recentJobs.map(j => (
                  <div key={j.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className={STATE_CONFIG[j.state].color}>{STATE_CONFIG[j.state].label}</span>
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
