import { useState } from 'react'
import { ProvisioningJobBadge } from './ProvisioningJobBadge'
import { Button } from '@/components/ui/button'
import { useDeleteProvisioningJob } from '@/hooks/useProvisioning'
import { useJobSessions, useJobSessionLogs } from '@/hooks/useDiagnostics'
import { useToast } from '@/components/ui/toast'
import type { ProvisioningJob } from '@ninja/types'
import { ChevronDown, ChevronRight, Trash2, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProvisioningJobRowProps {
  job: ProvisioningJob
  isAdmin: boolean
}

const TERMINAL_STATES = new Set(['done', 'failed'])

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const DEPLOYABLE_STATES = new Set(['deploying', 'done', 'failed'])

function AgentDeployLogs({ jobId }: { jobId: string }) {
  const { data: sessions, isLoading: sessionsLoading } = useJobSessions('provisioning', jobId)
  const sessionId = sessions?.[0]?.sessionId ?? null
  const { data: logs, isLoading: logsLoading } = useJobSessionLogs(sessionId)

  if (sessionsLoading) {
    return <p className="text-xs text-zinc-500 py-2">Loading…</p>
  }
  if (!sessionId) {
    return <p className="text-xs text-zinc-500 py-2">No agent deploy logs recorded.</p>
  }
  return (
    <div className="rounded border border-zinc-700 bg-zinc-950 overflow-hidden mt-2">
      <div className="px-3 py-1.5 border-b border-zinc-800">
        <span className="text-xs font-mono text-zinc-500">Session {sessionId.slice(0, 8)}</span>
      </div>
      <div className="p-3 font-mono text-xs max-h-64 overflow-y-auto space-y-0.5">
        {logsLoading ? (
          <span className="text-zinc-500">Loading logs…</span>
        ) : logs && logs.length > 0 ? (
          logs.map((entry) => (
            <div key={entry.id} className={entry.stream === 'stderr' ? 'text-red-400' : 'text-zinc-200'}>
              <span className="text-zinc-600 select-none mr-2">
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
              {entry.data.replace(/\n$/, '')}
            </div>
          ))
        ) : (
          <span className="text-zinc-500">No log entries for this session.</span>
        )}
      </div>
    </div>
  )
}

export function ProvisioningJobRow({ job, isAdmin }: ProvisioningJobRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [logsExpanded, setLogsExpanded] = useState(false)
  const { mutate: deleteJob, isPending } = useDeleteProvisioningJob()
  const { toast } = useToast()

  const showLogsButton = job.guestType === 'lxc' && job.deployAgent && DEPLOYABLE_STATES.has(job.state)

  const handleDelete = () => {
    deleteJob(job.id, {
      onSuccess: () => toast({ title: 'Job deleted', variant: 'success' }),
      onError: (err) => toast({ title: 'Delete failed', description: String(err), variant: 'error' }),
    })
  }

  return (
    <>
      <tr
        className={cn(
          'border-b border-zinc-100 dark:border-zinc-800',
          job.state === 'failed' && 'bg-red-50 dark:bg-red-950/20',
        )}
      >
        <td className="px-4 py-3 text-xs font-mono text-zinc-500 dark:text-zinc-400">
          {job.id.slice(0, 8)}
        </td>
        <td className="px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {job.name}
        </td>
        <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400 capitalize">
          {job.guestType}
        </td>
        <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
          {job.vmid}
        </td>
        <td className="px-4 py-3">
          <ProvisioningJobBadge state={job.state} />
        </td>
        <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
          {formatDate(job.createdAt)}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {job.state === 'failed' && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label="Toggle error details"
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
            {showLogsButton && (
              <button
                onClick={() => setLogsExpanded(e => !e)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label="Toggle deploy logs"
                title="Agent deploy logs"
              >
                <ScrollText size={14} />
              </button>
            )}
            {isAdmin && TERMINAL_STATES.has(job.state) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={isPending}
                className="h-7 w-7 p-0 text-zinc-400 hover:text-red-500"
                aria-label="Delete job"
              >
                <Trash2 size={13} />
              </Button>
            )}
          </div>
        </td>
      </tr>
      {expanded && job.errorMessage && (
        <tr className="bg-red-50 dark:bg-red-950/20">
          <td colSpan={7} className="px-4 pb-3">
            <p className="text-xs font-mono text-red-700 dark:text-red-400 whitespace-pre-wrap">
              {job.errorMessage}
            </p>
          </td>
        </tr>
      )}
      {logsExpanded && (
        <tr>
          <td colSpan={7} className="px-4 pb-3 bg-zinc-900/40">
            <AgentDeployLogs jobId={job.id} />
          </td>
        </tr>
      )}
    </>
  )
}
