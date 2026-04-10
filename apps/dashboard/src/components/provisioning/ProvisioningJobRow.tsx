import { useState } from 'react'
import { ProvisioningJobBadge } from './ProvisioningJobBadge'
import { Button } from '@/components/ui/button'
import { useDeleteProvisioningJob } from '@/hooks/useProvisioning'
import { useToast } from '@/components/ui/toast'
import type { ProvisioningJob } from '@ninja/types'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
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

export function ProvisioningJobRow({ job, isAdmin }: ProvisioningJobRowProps) {
  const [expanded, setExpanded] = useState(false)
  const { mutate: deleteJob, isPending } = useDeleteProvisioningJob()
  const { toast } = useToast()

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
    </>
  )
}
