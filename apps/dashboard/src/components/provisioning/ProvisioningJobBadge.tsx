import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ProvisioningState } from '@ninja/types'

const config: Record<ProvisioningState, {
  variant: 'secondary' | 'default' | 'success' | 'destructive'
  label: string
  dotClass: string
  pulse?: boolean
}> = {
  pending:   { variant: 'secondary',    label: 'Pending',   dotClass: 'bg-zinc-400' },
  creating:  { variant: 'default',      label: 'Creating',  dotClass: 'bg-blue-500', pulse: true },
  starting:  { variant: 'default',      label: 'Starting',  dotClass: 'bg-blue-500', pulse: true },
  deploying: { variant: 'default',      label: 'Deploying', dotClass: 'bg-blue-500', pulse: true },
  done:      { variant: 'success',      label: 'Done',      dotClass: 'bg-green-500' },
  failed:    { variant: 'destructive',  label: 'Failed',    dotClass: 'bg-red-500' },
}

interface ProvisioningJobBadgeProps {
  state: ProvisioningState
  className?: string
}

export function ProvisioningJobBadge({ state, className }: ProvisioningJobBadgeProps) {
  const c = config[state]
  return (
    <Badge variant={c.variant} className={className}>
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          c.dotClass,
          c.pulse && 'animate-pulse-dot',
        )}
      />
      {c.label}
    </Badge>
  )
}
