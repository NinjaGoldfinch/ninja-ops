import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import { layoutRoute } from '@/layout-route'
import { useAgents, useDeleteAgent } from '@/hooks/useAgents'
import { useBundleInfo, useRedeployAgent, useRedeployAll, useRedeployLiveUpdates } from '@/hooks/useAgentRedeploy'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { RedeployDrawer } from '@/components/agents/RedeployDrawer'
import { Trash2, RefreshCw } from 'lucide-react'
import { formatRelative } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Agent } from '@ninja/types'

export const agentsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/agents',
  component: AgentsPage,
})

function AgentsPage() {
  const { data: agents, isLoading, error, refetch } = useAgents()
  const { data: bundleInfo } = useBundleInfo()
  const { mutate: deleteAgent } = useDeleteAgent()
  const { mutate: redeployAgent } = useRedeployAgent()
  const { mutate: redeployAll, isPending: isRedeployingAll } = useRedeployAll()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const isAdmin = user?.role === 'admin'

  const [drawerAgent, setDrawerAgent] = useState<Agent | null>(null)
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null)

  useRedeployLiveUpdates()

  const isOutdated = (agent: Agent): boolean => {
    if (!bundleInfo) return false
    const expected = agent.kind === 'log' ? bundleInfo.logAgentHash : bundleInfo.deployAgentHash
    return agent.bundleHash !== expected
  }

  const handleRedeploy = (agent: Agent) => {
    redeployAgent(agent.id, {
      onSuccess: (job) => {
        setDrawerAgent(agent)
        setDrawerJobId(job.id)
      },
      onError: (err) => toast({ title: 'Redeploy failed', description: String(err), variant: 'error' }),
    })
  }

  const handleRedeployAll = () => {
    redeployAll({ onlyOutdated: true }, {
      onSuccess: (jobs) =>
        toast({ title: `Queued ${jobs.length} redeploy${jobs.length !== 1 ? 's' : ''}`, variant: 'success' }),
      onError: (err) => toast({ title: 'Redeploy all failed', description: String(err), variant: 'error' }),
    })
  }

  const numCols = isAdmin ? 7 : 6

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {agents?.length ?? '—'} agent{agents?.length !== 1 ? 's' : ''} registered
        </p>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRedeployAll}
            disabled={isRedeployingAll}
          >
            <RefreshCw size={14} className="mr-1.5" />
            Redeploy outdated
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Agent</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">VMID</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Version</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Status</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Last seen</th>
              {isAdmin && (
                <>
                  <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"></th>
                  <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"></th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                    {Array.from({ length: numCols }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : agents?.map((agent) => {
                  const outdated = isOutdated(agent)
                  return (
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
                        <span title={agent.bundleHash}>{agent.bundleHash.slice(0, 12)}</span>
                        {outdated && (
                          <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
                            Update available
                          </span>
                        )}
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
                        <>
                          <td className="px-4 py-2.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={() => handleRedeploy(agent)}
                            >
                              <RefreshCw size={12} className="mr-1" />
                              Redeploy
                            </Button>
                          </td>
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
                        </>
                      )}
                    </tr>
                  )
                })}
            {!isLoading && (!agents || agents.length === 0) && (
              <tr>
                <td colSpan={numCols} className="px-4 py-10 text-center">
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

      {drawerAgent && drawerJobId && (
        <RedeployDrawer
          agent={drawerAgent}
          jobId={drawerJobId}
          onClose={() => {
            setDrawerAgent(null)
            setDrawerJobId(null)
          }}
        />
      )}
    </div>
  )
}
