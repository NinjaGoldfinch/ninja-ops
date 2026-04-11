import { createRoute } from '@tanstack/react-router'
import { layoutRoute } from '@/layout-route'
import { useAgents, useDeleteAgent } from '@/hooks/useAgents'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { Trash2 } from 'lucide-react'
import { formatRelative } from '@/lib/utils'
import { cn } from '@/lib/utils'

export const agentsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/agents',
  component: AgentsPage,
})

function AgentsPage() {
  const { data: agents, isLoading, error, refetch } = useAgents()
  const { mutate: deleteAgent } = useDeleteAgent()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const isAdmin = user?.role === 'admin'

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {agents?.length ?? '—'} agent{agents?.length !== 1 ? 's' : ''} registered
      </p>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Agent</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">VMID</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Version</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Status</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Last seen</th>
              {isAdmin && <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"></th>}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                    {Array.from({ length: isAdmin ? 6 : 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : agents?.map((agent) => (
                  <tr
                    key={agent.id}
                    className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-mono text-sm text-zinc-900 dark:text-zinc-100">
                      {agent.hostname}
                      <span className="text-zinc-400 dark:text-zinc-600">:{agent.kind}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {agent.vmid}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {agent.version}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        'inline-flex items-center gap-1.5 text-xs font-medium',
                        agent.status === 'idle' ? 'text-green-600 dark:text-green-400' :
                        agent.status === 'busy' ? 'text-blue-600 dark:text-blue-400' :
                        'text-zinc-500 dark:text-zinc-400',
                      )}>
                        <span className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          agent.status === 'idle' ? 'bg-green-500' :
                          agent.status === 'busy' ? 'bg-blue-500 animate-pulse-dot' :
                          'bg-zinc-400',
                        )} />
                        {agent.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {formatRelative(agent.lastSeenAt)}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => {
                            if (confirm(`Delete agent ${agent.hostname}:${agent.kind}?`)) {
                              deleteAgent(agent.id, {
                                onSuccess: () => toast({ title: 'Agent deleted', variant: 'success' }),
                                onError: (err) =>
                                  toast({ title: 'Failed', description: String(err), variant: 'error' }),
                              })
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
            {!isLoading && (!agents || agents.length === 0) && (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="px-4 py-10 text-center">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No agents registered</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                    Agents register themselves on startup.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
