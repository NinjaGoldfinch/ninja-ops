import { createRoute } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { Server, Bot, Activity } from 'lucide-react'
import { layoutRoute } from '@/layout-route'
import { useNodes } from '@/hooks/useNodes'
import { useAgents } from '@/hooks/useAgents'
import { NodeCard } from '@/components/nodes/NodeCard'
import { MetricCard } from '@/components/metrics/MetricCard'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelative } from '@/lib/utils'

export const indexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  component: OverviewPage,
})

function OverviewPage() {
  const { data: nodes, isLoading: nodesLoading } = useNodes()
  const { data: agents, isLoading: agentsLoading } = useAgents()

  const onlineAgents = agents?.filter((a) => a.status !== 'offline').length ?? 0

  return (
    <div className="space-y-8">
      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Nodes"
          value={nodes?.length ?? null}
          icon={<Server size={18} />}
        />
        <MetricCard
          label="Agents Online"
          value={agents ? onlineAgents : null}
          sub={`of ${agents?.length ?? 0} total`}
          icon={<Bot size={18} />}
        />
        <MetricCard
          label="Agents Total"
          value={agents?.length ?? null}
          icon={<Activity size={18} />}
        />
      </div>

      {/* Node health strip */}
      <section>
        <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
          Node Health
        </h2>
        {nodesLoading ? (
          <div className="flex gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-48" />
            ))}
          </div>
        ) : nodes && nodes.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {nodes.map((node) => (
              <div key={node.id} className="w-48">
                <NodeCard node={node} />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-8 text-center">
            <Server size={24} className="mx-auto mb-2 text-zinc-400" />
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No nodes registered</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Add a Proxmox node to get started.
            </p>
            <Link
              to="/nodes"
              className="mt-3 inline-flex items-center text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Go to Nodes →
            </Link>
          </div>
        )}
      </section>

      {/* Active agents */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            Agents
          </h2>
          <Link to="/agents" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            View all →
          </Link>
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Hostname</th>
                <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">VMID</th>
                <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {agentsLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                : agents?.slice(0, 5).map((agent) => (
                    <tr
                      key={agent.id}
                      className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono text-sm text-zinc-900 dark:text-zinc-100">
                        {agent.hostname}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {agent.vmid}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                          agent.status === 'idle' ? 'text-green-600 dark:text-green-400' :
                          agent.status === 'busy' ? 'text-blue-600 dark:text-blue-400' :
                          'text-zinc-500 dark:text-zinc-400'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            agent.status === 'idle' ? 'bg-green-500' :
                            agent.status === 'busy' ? 'bg-blue-500 animate-pulse-dot' :
                            'bg-zinc-400'
                          }`} />
                          {agent.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {formatRelative(agent.lastSeenAt)}
                      </td>
                    </tr>
                  ))}
              {!agentsLoading && (!agents || agents.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    No agents registered
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
