import { createRoute } from '@tanstack/react-router'
import { nodeIdRoute } from './route'
import { useNode } from '@/hooks/useNodes'
import { useGuests } from '@/hooks/useGuests'
import { useAuthStore } from '@/stores/auth'
import { GuestTable } from '@/components/guests/GuestTable'
import { NodeStatusBadge } from '@/components/nodes/NodeStatusBadge'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelative } from '@/lib/utils'

export const nodeDetailRoute = createRoute({
  getParentRoute: () => nodeIdRoute,
  path: '/',
  component: NodeDetailPage,
})

function NodeDetailPage() {
  const { nodeId } = nodeIdRoute.useParams()
  const { data: node, isLoading: nodeLoading, error: nodeError, refetch: refetchNode } = useNode(nodeId)
  const { data: guests, isLoading: guestsLoading, error: guestsError, refetch: refetchGuests } = useGuests(nodeId)
  const { user } = useAuthStore()

  const canPower = user?.role === 'admin' || user?.role === 'operator'

  if (nodeError) return <QueryError error={nodeError} onRetry={() => void refetchNode()} />
  if (guestsError) return <QueryError error={guestsError} onRetry={() => void refetchGuests()} />

  return (
    <div className="space-y-6">
      {/* Node header */}
      <div className="flex items-start gap-4">
        <div className="min-w-0">
          {nodeLoading ? (
            <Skeleton className="h-7 w-48" />
          ) : (
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{node?.name}</h2>
              {node && <NodeStatusBadge status={node.status} />}
            </div>
          )}
          {nodeLoading ? (
            <Skeleton className="h-4 w-64 mt-1" />
          ) : node ? (
            <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 mt-1">
              {node.host}:{node.port}
              <span className="ml-3">Updated {formatRelative(node.updatedAt)}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* Guest table */}
      <GuestTable
        guests={guests ?? []}
        nodeId={nodeId}
        isLoading={guestsLoading}
        canPower={canPower}
      />
    </div>
  )
}
