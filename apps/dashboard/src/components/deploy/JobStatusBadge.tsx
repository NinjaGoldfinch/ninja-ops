import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { DeployState } from '@ninja/types'

const config: Record<DeployState, { variant: 'secondary' | 'default' | 'success' | 'destructive' | 'warning'; label: string; pulse?: boolean }> = {
  queued: { variant: 'secondary', label: 'Queued' },
  dispatched: { variant: 'default', label: 'Dispatched' },
  running: { variant: 'default', label: 'Running', pulse: true },
  success: { variant: 'success', label: 'Success' },
  failed: { variant: 'destructive', label: 'Failed' },
  cancelled: { variant: 'secondary', label: 'Cancelled' },
}

interface JobStatusBadgeProps {
  state: DeployState
  className?: string
}

export function JobStatusBadge({ state, className }: JobStatusBadgeProps) {
  const c = config[state]
  return (
    <Badge variant={c.variant} className={className}>
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          state === 'running' || state === 'dispatched' ? 'bg-blue-500' :
          state === 'success' ? 'bg-green-500' :
          state === 'failed' ? 'bg-red-500' : 'bg-zinc-400',
          c.pulse && 'animate-pulse-dot',
        )}
      />
      {c.label}
    </Badge>
  )
}
