import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PowerActionMenu } from './PowerActionMenu'
import { formatUptime } from '@/lib/utils'
import { useGuestMetrics } from '@/hooks/useMetrics'
import { useDeployAgent, useDeployLogAgent } from '@/hooks/useGuests'
import { useAgents } from '@/hooks/useAgents'
import { useToast } from '@/components/ui/toast'
import { Eye, Bot, ScrollText } from 'lucide-react'
import type { Guest } from '@ninja/types'

interface GuestRowProps {
  guest: Guest
  nodeId: string
  canPower: boolean
  isAdmin?: boolean | undefined
}

const statusConfig = {
  running: { variant: 'success' as const, label: 'Running' },
  stopped: { variant: 'secondary' as const, label: 'Stopped' },
  paused: { variant: 'warning' as const, label: 'Paused' },
  unknown: { variant: 'outline' as const, label: 'Unknown' },
}

const agentStatusConfig = {
  idle: { dot: 'bg-green-500', label: 'Idle' },
  busy: { dot: 'bg-amber-500', label: 'Busy' },
  offline: { dot: 'bg-zinc-400', label: 'Offline' },
}

export function GuestRow({ guest, nodeId, canPower, isAdmin }: GuestRowProps) {
  const { latest } = useGuestMetrics(nodeId, guest.vmid)
  const { mutate: deployAgent, isPending: deploying } = useDeployAgent()
  const { mutate: deployLogAgent, isPending: deployingLog } = useDeployLogAgent()
  const { data: agents } = useAgents()
  const { toast } = useToast()

  const liveStatus = latest?.status ?? guest.status
  const liveUptime = latest?.uptime ?? guest.uptime ?? 0
  const statusCfg = statusConfig[liveStatus] ?? statusConfig.unknown
  const isStopped = liveStatus === 'stopped'

  const cpuPct = !isStopped && latest ? Math.round(latest.cpu * 100) : null
  const memPct = !isStopped && latest && latest.maxmem > 0
    ? Math.round((latest.mem / latest.maxmem) * 100)
    : null

  const deployAgentRecord = agents?.find(a => a.nodeId === nodeId && a.vmid === guest.vmid && a.kind === 'deploy')
  const logAgentRecord = agents?.find(a => a.nodeId === nodeId && a.vmid === guest.vmid && a.kind === 'log')

  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group">
      <td className="px-4 py-3 font-mono text-xs text-zinc-400 dark:text-zinc-500 w-14">
        {guest.vmid}
      </td>
      <td className="px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {guest.name}
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className="font-mono text-xs uppercase">
          {guest.type}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <Badge variant={statusCfg.variant}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            liveStatus === 'running' ? 'bg-green-500' :
            liveStatus === 'paused' ? 'bg-amber-500' : 'bg-zinc-400'
          }`} />
          {statusCfg.label}
        </Badge>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400 w-14 tabular-nums">
        {cpuPct !== null ? `${cpuPct}%` : '—'}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400 w-14 tabular-nums">
        {memPct !== null ? `${memPct}%` : '—'}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400 w-20 tabular-nums">
        {liveUptime > 0 ? formatUptime(liveUptime) : '—'}
      </td>
      <td className="px-4 py-3 w-32">
        <div className="flex flex-col gap-1">
          {deployAgentRecord && (
            <Badge variant="outline" className="text-xs gap-1 w-fit" title="Deploy agent">
              <Bot size={10} />
              <span className={`h-1.5 w-1.5 rounded-full ${agentStatusConfig[deployAgentRecord.status]?.dot ?? 'bg-zinc-400'}`} />
              {agentStatusConfig[deployAgentRecord.status]?.label ?? 'Offline'}
            </Badge>
          )}
          {logAgentRecord && (
            <Badge variant="outline" className="text-xs gap-1 w-fit" title="Log agent">
              <ScrollText size={10} />
              <span className={`h-1.5 w-1.5 rounded-full ${agentStatusConfig[logAgentRecord.status]?.dot ?? 'bg-zinc-400'}`} />
              {agentStatusConfig[logAgentRecord.status]?.label ?? 'Offline'}
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-3 w-px whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          {isAdmin && guest.type === 'lxc' && (
            <Button
              variant="ghost"
              size="icon"
              disabled={deploying}
              aria-label={deploying ? 'Deploying agent…' : 'Deploy agent'}
              title={deploying ? 'Deploying agent…' : 'Deploy agent'}
              onClick={() => deployAgent(
                { nodeId, vmid: guest.vmid },
                {
                  onSuccess: () => toast({ title: 'Agent deployed', variant: 'success' }),
                  onError: (err) => toast({ title: 'Deploy failed', description: String(err), variant: 'error' }),
                },
              )}
            >
              <Bot size={14} className={deploying ? 'animate-pulse' : ''} />
            </Button>
          )}
          {isAdmin && guest.type === 'lxc' && (
            <Button
              variant="ghost"
              size="icon"
              disabled={deployingLog}
              aria-label={deployingLog ? 'Deploying log-agent…' : 'Deploy log-agent'}
              title={deployingLog ? 'Deploying log-agent…' : 'Deploy log-agent'}
              onClick={() => deployLogAgent(
                { nodeId, vmid: guest.vmid },
                {
                  onSuccess: () => toast({ title: 'Log-agent deployed', variant: 'success' }),
                  onError: (err) => toast({ title: 'Deploy failed', description: String(err), variant: 'error' }),
                },
              )}
            >
              <ScrollText size={14} className={deployingLog ? 'animate-pulse' : ''} />
            </Button>
          )}
          <Link to="/nodes/$nodeId/guests/$vmid" params={{ nodeId, vmid: String(guest.vmid) }}>
            <Button variant="ghost" size="icon" aria-label="View detail">
              <Eye size={14} />
            </Button>
          </Link>
          {canPower && <PowerActionMenu guest={{ ...guest, status: liveStatus }} />}
        </div>
      </td>
    </tr>
  )
}
