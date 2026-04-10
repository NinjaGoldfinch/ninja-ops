import { cn } from '@/lib/utils'
import type { ProxmoxNode } from '@ninja/types'

type NodeStatus = ProxmoxNode['status']

const config: Record<NodeStatus, { dot: string; label: string; text: string }> = {
  online: { dot: 'bg-green-500', label: 'Online', text: 'text-green-700 dark:text-green-400' },
  offline: { dot: 'bg-red-500', label: 'Offline', text: 'text-red-700 dark:text-red-400' },
  unknown: { dot: 'bg-zinc-400', label: 'Unknown', text: 'text-zinc-500 dark:text-zinc-400' },
}

interface NodeStatusBadgeProps {
  status: NodeStatus
  className?: string
}

export function NodeStatusBadge({ status, className }: NodeStatusBadgeProps) {
  const c = config[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', c.text, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      {c.label}
    </span>
  )
}
