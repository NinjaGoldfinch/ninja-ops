import { Link } from '@tanstack/react-router'
import { Server } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { NodeStatusBadge } from './NodeStatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { useNodeMetrics } from '@/hooks/useMetrics'
import type { ProxmoxNode } from '@ninja/types'

interface NodeCardProps {
  node: ProxmoxNode
}

export function NodeCard({ node }: NodeCardProps) {
  const { latest } = useNodeMetrics(node.id)

  const cpuPct = latest ? Math.round(latest.cpu * 100) : null
  const memPct =
    latest && latest.maxmem > 0
      ? Math.round((latest.mem / latest.maxmem) * 100)
      : null

  return (
    <Link to="/nodes/$nodeId" params={{ nodeId: node.id }}>
      <Card className="hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Server size={16} className="text-zinc-400 shrink-0" />
              <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                {node.name}
              </span>
            </div>
            <NodeStatusBadge status={node.status} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">CPU</p>
              {cpuPct !== null ? (
                <p className="font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {cpuPct}%
                </p>
              ) : (
                <Skeleton className="h-4 w-8" />
              )}
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">Mem</p>
              {memPct !== null ? (
                <p className="font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {memPct}%
                </p>
              ) : (
                <Skeleton className="h-4 w-8" />
              )}
            </div>
          </div>

          <p className="text-xs text-zinc-400 dark:text-zinc-500 font-mono mt-2 truncate">
            {node.host}:{node.port}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}
