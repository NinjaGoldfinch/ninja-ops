import { createRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ws } from '@/lib/ws'
import { nodeIdRoute } from '../route'
import { useGuest, useSnapshots, useCreateSnapshot, useDeleteSnapshot } from '@/hooks/useGuests'
import { useGuestMetrics } from '@/hooks/useMetrics'
import { useJobSessions, useJobSessionLogs } from '@/hooks/useDiagnostics'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/toast'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { CpuChart } from '@/components/metrics/CpuChart'
import { MemoryChart } from '@/components/metrics/MemoryChart'
import { NetworkChart } from '@/components/metrics/NetworkChart'
import { Terminal } from '@/components/terminal/Terminal'
import { Trash2, Plus, Lock } from 'lucide-react'
import { formatRelative, formatUptime } from '@/lib/utils'

export const guestDetailRoute = createRoute({
  getParentRoute: () => nodeIdRoute,
  path: '/guests/$vmid',
  component: GuestDetailPage,
})

function GuestDetailPage() {
  const { nodeId, vmid: vmidStr } = guestDetailRoute.useParams()
  const vmid = Number(vmidStr)
  const { data: guest, isLoading, error, refetch } = useGuest(nodeId, vmid)
  const { latest, history } = useGuestMetrics(nodeId, vmid)
  const { user } = useAuthStore()
  const { toast } = useToast()
  const [tab, setTab] = useState('metrics')

  const isAdmin = user?.role === 'admin'
  const canTerminal = user?.role === 'admin' || user?.role === 'operator'
  const [lastDeploySessionId, setLastDeploySessionId] = useState<string | null>(null)
  const sessionId = `term-${nodeId}-${vmid}`

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        {isLoading ? (
          <Skeleton className="h-7 w-48" />
        ) : guest ? (
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{guest.name}</h2>
              <Badge variant="outline" className="font-mono text-xs uppercase">{guest.type}</Badge>
              <Badge variant={(latest?.status ?? guest.status) === 'running' ? 'success' : 'secondary'}>
                {latest?.status ?? guest.status}
              </Badge>
            </div>
            <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 mt-1">
              VMID {guest.vmid}
              {(latest?.uptime ?? guest.uptime)
                ? ` · Uptime ${formatUptime(latest?.uptime ?? guest.uptime ?? 0)}`
                : ''}
            </p>
          </div>
        ) : null}

      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-fit">
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="commands">Commands</TabsTrigger>
          {isAdmin && guest?.type === 'lxc' && (
            <TabsTrigger value="deploy-logs">Deploy Logs</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="metrics" className="mt-4">
          <MetricsTab history={history} />
        </TabsContent>

        <TabsContent value="snapshots" className="mt-4">
          <SnapshotsTab nodeId={nodeId} vmid={vmid} />
        </TabsContent>

        <TabsContent value="terminal" className="mt-4">
          {canTerminal ? (
            <div style={{ height: 'calc(100vh - 320px)', minHeight: 400 }}>
              <Terminal nodeId={nodeId} vmid={vmid} sessionId={sessionId} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Lock size={24} className="text-zinc-400" />
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Insufficient permissions</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Operator or Admin role required.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="commands" className="mt-4">
          <CommandsTab nodeId={nodeId} vmid={vmid} sessionId={sessionId} canRun={canTerminal} toast={toast} />
        </TabsContent>

        {isAdmin && guest?.type === 'lxc' && (
          <TabsContent value="deploy-logs" className="mt-4">
            <DeployLogsTab nodeId={nodeId} vmid={vmid} initialSessionId={lastDeploySessionId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

// ─── Metrics Tab ─────────────────────────────────────────────────────────────

function MetricsTab({ history }: { history: ReturnType<typeof useGuestMetrics>['history'] }) {
  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-3">CPU Usage %</h3>
        {history.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-sm text-zinc-400">Waiting for data…</div>
        ) : (
          <CpuChart history={history} />
        )}
      </div>
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-3">Memory</h3>
        {history.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-sm text-zinc-400">Waiting for data…</div>
        ) : (
          <MemoryChart history={history} />
        )}
      </div>
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-3">Network</h3>
        {history.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-sm text-zinc-400">Waiting for data…</div>
        ) : (
          <NetworkChart history={history} />
        )}
      </div>
    </div>
  )
}

// ─── Snapshots Tab ────────────────────────────────────────────────────────────

function SnapshotsTab({ nodeId, vmid }: { nodeId: string; vmid: number }) {
  const { data: snapshots, isLoading } = useSnapshots(nodeId, vmid)
  const { mutate: createSnapshot, isPending: creating } = useCreateSnapshot()
  const { mutate: deleteSnapshot } = useDeleteSnapshot()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [vmstate, setVmstate] = useState(false)
  const [showForm, setShowForm] = useState(false)

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    createSnapshot(
      { nodeId, vmid, input: { name, description: desc, vmstate } },
      {
        onSuccess: () => {
          toast({ title: 'Snapshot created', variant: 'success' })
          setName(''); setDesc(''); setVmstate(false); setShowForm(false)
        },
        onError: (err) =>
          toast({ title: 'Failed to create snapshot', description: String(err), variant: 'error' }),
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={14} />
          Create snapshot
        </Button>
      </div>

      {showForm && (
        <form onSubmit={(e) => void handleCreate(e)} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="snap-2024-01-01" required />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional description" />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={vmstate} onChange={(e) => setVmstate(e.target.checked)} />
            Include RAM state
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={creating}>{creating ? 'Creating…' : 'Create'}</Button>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Name</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Date</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">RAM</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : snapshots?.map((snap) => (
                  <tr key={snap.name} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-sm text-zinc-900 dark:text-zinc-100">{snap.name}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {snap.snaptime ? formatRelative(new Date(snap.snaptime * 1000)) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {snap.vmstate && <Badge variant="secondary">Included</Badge>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => {
                          if (confirm(`Delete snapshot "${snap.name}"?`)) {
                            deleteSnapshot({ nodeId, vmid, name: snap.name })
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
            {!isLoading && (!snapshots || snapshots.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No snapshots
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Deploy Logs Tab ─────────────────────────────────────────────────────────

function DeployLogsTab({ nodeId, vmid, initialSessionId }: { nodeId: string; vmid: number; initialSessionId: string | null }) {
  const jobId = `${nodeId}/${vmid}`
  const { data: sessions, isLoading: sessionsLoading } = useJobSessions('agent_deploy', jobId)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  // When a new deploy completes and passes a sessionId, select it
  const [prevInitial, setPrevInitial] = useState(initialSessionId)
  if (initialSessionId !== prevInitial) {
    setPrevInitial(initialSessionId)
    setSelectedSessionId(initialSessionId)
  }

  const effectiveSessionId = selectedSessionId ?? sessions?.[0]?.sessionId ?? null
  const { data: logs, isLoading: logsLoading } = useJobSessionLogs(effectiveSessionId)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Session:</span>
        {sessionsLoading ? (
          <Skeleton className="h-8 w-48" />
        ) : sessions && sessions.length > 0 ? (
          <select
            className="text-xs font-mono bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1.5 text-zinc-900 dark:text-zinc-100"
            value={effectiveSessionId ?? ''}
            onChange={(e) => setSelectedSessionId(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {new Date(s.createdAt).toLocaleString()} — {s.sessionId.slice(0, 8)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">No deploy sessions yet</span>
        )}
      </div>

      {effectiveSessionId && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-400">Session {effectiveSessionId.slice(0, 8)}</span>
            {logsLoading && <span className="text-xs text-zinc-500">Loading…</span>}
          </div>
          <div className="p-3 font-mono text-xs max-h-[500px] overflow-y-auto space-y-0.5">
            {logsLoading ? (
              <div className="text-zinc-500 py-4 text-center">Loading logs…</div>
            ) : logs && logs.length > 0 ? (
              logs.map((entry) => (
                <div
                  key={entry.id}
                  className={entry.stream === 'stderr' ? 'text-red-400' : 'text-zinc-200'}
                >
                  <span className="text-zinc-600 select-none mr-2">
                    {new Date(entry.ts).toLocaleTimeString()}
                  </span>
                  {entry.data.replace(/\n$/, '')}
                </div>
              ))
            ) : (
              <div className="text-zinc-500 py-4 text-center">No log entries for this session</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Commands Tab ─────────────────────────────────────────────────────────────

interface SavedCommand {
  id: string
  label: string
  command: string
}

// TODO: commands are stored in component state only and do not persist.
// Implement GET/POST/DELETE /api/nodes/:nodeId/guests/:vmid/commands
// backed by the saved_commands table once the control-plane routes exist.
function CommandsTab({
  nodeId,
  vmid,
  sessionId,
  canRun,
  toast,
}: {
  nodeId: string
  vmid: number
  sessionId: string
  canRun: boolean
  toast: ReturnType<typeof useToast>['toast']
}) {
  const [commands, setCommands] = useState<SavedCommand[]>([])
  const [label, setLabel] = useState('')
  const [cmd, setCmd] = useState('')

  function addCommand(e: React.FormEvent) {
    e.preventDefault()
    setCommands((prev) => [...prev, { id: crypto.randomUUID(), label, command: cmd }])
    setLabel(''); setCmd('')
  }

  function runCommand(command: string) {
    if (!canRun) return
    ws.send({ type: 'terminal_input', sessionId, data: command + '\n' })
    toast({ title: 'Command sent', variant: 'success' })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Label</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Command</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"></th>
            </tr>
          </thead>
          <tbody>
            {commands.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <td className="px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100">{c.label}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">{c.command}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" disabled={!canRun} onClick={() => runCommand(c.command)}>
                      Run
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-red-500 hover:text-red-600"
                      onClick={() => setCommands((prev) => prev.filter((x) => x.id !== c.id))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {commands.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No saved commands
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={(e) => void addCommand(e)} className="flex items-end gap-2">
        <div className="space-y-1.5 flex-1">
          <Label>Label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Restart service" required />
        </div>
        <div className="space-y-1.5 flex-[2]">
          <Label>Command</Label>
          <Input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="systemctl restart myapp" required className="font-mono" />
        </div>
        <Button type="submit" size="sm">
          <Plus size={14} />
          Add
        </Button>
      </form>
    </div>
  )
}
