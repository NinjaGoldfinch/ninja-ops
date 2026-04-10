import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PowerActionMenu } from './PowerActionMenu'
import { GuestMetricsSparkline } from './GuestMetricsSparkline'
import { formatUptime } from '@/lib/utils'
import { useGuestMetrics } from '@/hooks/useMetrics'
import { Eye } from 'lucide-react'
import type { Guest } from '@ninja/types'

interface GuestRowProps {
  guest: Guest
  nodeId: string
  canPower: boolean
}

const statusConfig = {
  running: { variant: 'success' as const, label: 'Running' },
  stopped: { variant: 'secondary' as const, label: 'Stopped' },
  paused: { variant: 'warning' as const, label: 'Paused' },
  unknown: { variant: 'outline' as const, label: 'Unknown' },
}

export function GuestRow({ guest, nodeId, canPower }: GuestRowProps) {
  const { latest } = useGuestMetrics(nodeId, guest.vmid)

  // Prefer live metrics values; fall back to REST snapshot
  const liveStatus = latest?.status ?? guest.status
  const liveUptime = latest?.uptime ?? guest.uptime ?? 0
  const statusCfg = statusConfig[liveStatus] ?? statusConfig.unknown
  const isStopped = liveStatus === 'stopped'

  const memPct =
    !isStopped && latest && latest.maxmem > 0
      ? Math.round((latest.mem / latest.maxmem) * 100)
      : null

  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
      <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400 w-16">
        {guest.vmid}
      </td>
      <td className="px-4 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {guest.name}
      </td>
      <td className="px-4 py-2.5">
        <Badge variant="outline" className="font-mono text-xs uppercase">
          {guest.type}
        </Badge>
      </td>
      <td className="px-4 py-2.5">
        <Badge variant={statusCfg.variant}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            liveStatus === 'running' ? 'bg-green-500' :
            liveStatus === 'paused' ? 'bg-amber-500' : 'bg-zinc-400'
          }`} />
          {statusCfg.label}
        </Badge>
      </td>
      <td className="px-4 py-2.5 w-32">
        {isStopped
          ? <span className="font-mono text-xs text-zinc-400 line-through">N/A</span>
          : <GuestMetricsSparkline nodeId={nodeId} vmid={guest.vmid} />
        }
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-400 w-16">
        {isStopped ? <span className="text-zinc-400">—</span> : memPct !== null ? `${memPct}%` : '—'}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400 w-20">
        {liveUptime > 0 ? formatUptime(liveUptime) : '—'}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <Link to="/nodes/$nodeId/guests/$vmid" params={{ nodeId, vmid: String(guest.vmid) }}>
            <Button variant="ghost" size="icon" aria-label="View detail">
              <Eye size={14} />
            </Button>
          </Link>
          {canPower && <PowerActionMenu guest={guest} />}
        </div>
      </td>
    </tr>
  )
}
