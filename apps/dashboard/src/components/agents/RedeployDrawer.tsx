import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useRedeployJob, useCancelRedeploy } from '@/hooks/useAgentRedeploy'
import { useJobSessions, useJobSessionLogs } from '@/hooks/useDiagnostics'
import { useToast } from '@/components/ui/toast'
import type { Agent, AgentRedeployJob } from '@ninja/types'
import { cn } from '@/lib/utils'

interface RedeployDrawerProps {
  agent: Agent
  jobId: string | null
  onClose: () => void
}

const STATE_COLORS: Record<AgentRedeployJob['state'], string> = {
  queued:    'text-zinc-400',
  running:   'text-blue-400',
  success:   'text-green-400',
  failed:    'text-red-400',
  cancelled: 'text-zinc-500',
}

function RedeployLogs({ jobId }: { jobId: string }) {
  const { data: sessions } = useJobSessions('agent_redeploy', jobId, true)
  const sessionId = sessions?.[0]?.sessionId ?? null
  const { data: logs } = useJobSessionLogs(sessionId, true)

  if (!sessionId) {
    return <p className="text-xs text-zinc-500 mt-2">No logs yet — waiting for job to start…</p>
  }

  return (
    <div className="rounded border border-zinc-700 bg-zinc-950 overflow-hidden mt-3">
      <div className="px-3 py-1.5 border-b border-zinc-800">
        <span className="text-xs font-mono text-zinc-500">Session {sessionId.slice(0, 8)}</span>
      </div>
      <div className="p-3 font-mono text-xs max-h-80 overflow-y-auto space-y-0.5">
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
      </div>
    </div>
  )
}

export function RedeployDrawer({ agent, jobId, onClose }: RedeployDrawerProps) {
  const { data: job, isLoading } = useRedeployJob(jobId)
  const { mutate: cancelJob } = useCancelRedeploy()
  const { toast } = useToast()

  const handleCancel = () => {
    if (!jobId) return
    cancelJob(jobId, {
      onSuccess: () => toast({ title: 'Redeploy cancelled', variant: 'success' }),
      onError: (err) => toast({ title: 'Cancel failed', description: String(err), variant: 'error' }),
    })
  }

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
          <div className="flex items-center justify-between">
            <span className={cn('text-sm font-medium', STATE_COLORS[job.state])}>
              {job.state.charAt(0).toUpperCase() + job.state.slice(1)}
            </span>
            {job.state === 'queued' && (
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            )}
          </div>

          {job.errorMessage && (
            <div className="rounded bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-400 font-mono">
              {job.errorMessage}
            </div>
          )}

          <div className="text-xs text-zinc-500 space-y-1">
            <div>Queued: {new Date(job.queuedAt).toLocaleString()}</div>
            {job.startedAt && <div>Started: {new Date(job.startedAt).toLocaleString()}</div>}
            {job.finishedAt && <div>Finished: {new Date(job.finishedAt).toLocaleString()}</div>}
          </div>

          {(job.state === 'running' || job.state === 'success' || job.state === 'failed') && (
            <RedeployLogs jobId={job.id} />
          )}
        </div>
      )}
    </Sheet>
  )
}
