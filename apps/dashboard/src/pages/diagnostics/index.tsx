import { createRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { layoutRoute } from '@/layout-route'
import { useNodes } from '@/hooks/useNodes'
import { useGuests } from '@/hooks/useGuests'
import { useSystemHealth, useTestSsh, useDiagnosticExec } from '@/hooks/useDiagnostics'
import { useControlLogsStore } from '@/stores/controlLogs'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle, XCircle, Minus, RefreshCw, Play, Trash2, Wifi, Terminal, ScrollText, Circle } from 'lucide-react'

export const diagnosticsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/diagnostics',
  component: DiagnosticsPage,
})

function StatusDot({ status }: { status: 'ok' | 'error' | 'unconfigured' | 'pending' }) {
  if (status === 'ok')
    return <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><CheckCircle size={13} /> OK</span>
  if (status === 'error')
    return <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><XCircle size={13} /> Error</span>
  if (status === 'unconfigured')
    return <span className="flex items-center gap-1 text-xs text-zinc-400"><Minus size={13} /> Not configured</span>
  return <span className="flex items-center gap-1 text-xs text-zinc-400">Checking…</span>
}

function DiagnosticsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-zinc-500">Admin access required.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <LogPanel />
      <HealthPanel />
      <SshPanel />
      <ExecPanel />
    </div>
  )
}

// ─── Log Panel ────────────────────────────────────────────────────────────────

function LogPanel() {
  const { lines, active, connect, disconnect, clear } = useControlLogsStore()
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScrollText size={15} />
            <CardTitle>Control-plane logs</CardTitle>
            {active && (
              <span className="flex items-center gap-1 text-xs text-green-500">
                <Circle size={7} className="fill-green-500" /> live
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lines.length > 0 && (
              <Button size="sm" variant="outline" onClick={clear}>
                <Trash2 size={13} /> Clear
              </Button>
            )}
            <Button
              size="sm"
              variant={active ? 'outline' : 'default'}
              onClick={() => active ? disconnect() : connect()}
            >
              {active ? 'Disconnect' : 'Connect'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!active && lines.length === 0 && (
          <p className="text-xs text-zinc-500">Click Connect to start tailing control-plane stdout/stderr.</p>
        )}
        {(active || lines.length > 0) && (
          <pre
            ref={outputRef}
            className="p-3 rounded-md bg-zinc-950 text-xs font-mono max-h-96 overflow-y-auto leading-relaxed"
          >
            {lines.map((line, i) => (
              <span key={i} className={line.stream === 'stderr' ? 'text-red-400' : 'text-zinc-300'}>
                {line.data}
              </span>
            ))}
            {active && lines.length === 0 && (
              <span className="text-zinc-600">Waiting for output…</span>
            )}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Health Panel ─────────────────────────────────────────────────────────────

function HealthPanel() {
  const { data, isFetching, refetch } = useSystemHealth()

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>System Health</CardTitle>
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            {isFetching ? 'Checking…' : 'Run health check'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isFetching && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
          </div>
        )}
        {!isFetching && !data && (
          <p className="text-xs text-zinc-500">Click "Run health check" to test system connectivity.</p>
        )}
        {!isFetching && data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 max-w-xs">
              <div>
                <p className="text-xs text-zinc-500 mb-1">Database</p>
                <StatusDot status={data.db} />
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1">Redis</p>
                <StatusDot status={data.redis} />
              </div>
            </div>

            {data.nodes.length > 0 && (
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-2">Nodes</p>
                <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                      <tr>
                        <th className="px-3 py-2 text-xs font-medium text-zinc-500">Name</th>
                        <th className="px-3 py-2 text-xs font-medium text-zinc-500">Proxmox API</th>
                        <th className="px-3 py-2 text-xs font-medium text-zinc-500">SSH</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.nodes.map((node) => (
                        <tr key={node.id} className="border-b last:border-0 border-zinc-100 dark:border-zinc-800">
                          <td className="px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">{node.name}</td>
                          <td className="px-3 py-2"><StatusDot status={node.api} /></td>
                          <td className="px-3 py-2"><StatusDot status={node.ssh} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── SSH Panel ────────────────────────────────────────────────────────────────

function SshPanel() {
  const { data: nodes } = useNodes()
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const { mutate: testSsh, isPending, data: result, error, reset } = useTestSsh()

  function handleTest() {
    if (!selectedNodeId) return
    reset()
    testSsh(selectedNodeId)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wifi size={15} />
          <CardTitle>SSH Connection Test</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5 flex-1 max-w-xs">
            <Label htmlFor="ssh-node">Node</Label>
            <Select
              id="ssh-node"
              value={selectedNodeId}
              onChange={(e) => { setSelectedNodeId(e.target.value); reset() }}
            >
              <option value="">Select a node…</option>
              {nodes?.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </Select>
          </div>
          <Button onClick={handleTest} disabled={!selectedNodeId || isPending}>
            {isPending ? 'Testing…' : 'Test SSH'}
          </Button>
        </div>

        {result && (
          <div className="mt-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle size={14} />
            Connected to <code className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">{result.host}</code>
            in {result.latencyMs}ms
          </div>
        )}
        {error && (
          <div className="mt-3 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <p className="text-xs font-medium text-red-700 dark:text-red-400">SSH failed</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 font-mono">{String(error)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Exec Console Panel ───────────────────────────────────────────────────────

function ExecPanel() {
  const { data: nodes } = useNodes()
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [selectedVmid, setSelectedVmid] = useState('')
  const [commandInput, setCommandInput] = useState('echo hello')
  const outputRef = useRef<HTMLPreElement>(null)

  const { data: guests } = useGuests(selectedNodeId)
  const lxcGuests = guests?.filter((g) => g.type === 'lxc') ?? []

  const { lines, isRunning, exitCode, error, execute, clear } = useDiagnosticExec()

  // Auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  function handleExecute() {
    if (!selectedNodeId || !selectedVmid || !commandInput.trim()) return
    const parts = commandInput.trim().split(/\s+/)
    execute(selectedNodeId, Number(selectedVmid), parts)
  }

  const hasOutput = lines.length > 0 || isRunning

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Terminal size={15} />
          <CardTitle>LXC Exec Console</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 max-w-lg">
          <div className="space-y-1.5">
            <Label htmlFor="exec-node">Node</Label>
            <Select
              id="exec-node"
              value={selectedNodeId}
              onChange={(e) => { setSelectedNodeId(e.target.value); setSelectedVmid('') }}
            >
              <option value="">Select a node…</option>
              {nodes?.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exec-vmid">Container (LXC)</Label>
            <Select
              id="exec-vmid"
              value={selectedVmid}
              onChange={(e) => setSelectedVmid(e.target.value)}
              disabled={!selectedNodeId}
            >
              <option value="">Select a container…</option>
              {lxcGuests.map((g) => (
                <option key={g.vmid} value={String(g.vmid)}>{g.name} ({g.vmid})</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex items-end gap-2 max-w-lg">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="exec-cmd">Command</Label>
            <Input
              id="exec-cmd"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="echo hello"
              onKeyDown={(e) => { if (e.key === 'Enter' && !isRunning) handleExecute() }}
              className="font-mono text-sm"
            />
          </div>
          <Button
            onClick={handleExecute}
            disabled={isRunning || !selectedNodeId || !selectedVmid || !commandInput.trim()}
          >
            <Play size={13} />
            {isRunning ? 'Running…' : 'Execute'}
          </Button>
          {hasOutput && (
            <Button variant="outline" onClick={clear} disabled={isRunning}>
              <Trash2 size={13} />
              Clear
            </Button>
          )}
        </div>

        {hasOutput && (
          <div className="rounded-md overflow-hidden border border-zinc-800">
            <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
              <span className="text-xs text-zinc-500 font-mono">output</span>
              <div className="flex items-center gap-2">
                {isRunning && (
                  <span className="flex items-center gap-1 text-xs text-blue-400">
                    <RefreshCw size={11} className="animate-spin" /> running
                  </span>
                )}
                {!isRunning && exitCode !== null && (
                  <span className={`text-xs font-mono ${exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                    exit {exitCode}
                  </span>
                )}
                {!isRunning && error && exitCode === null && (
                  <span className="text-xs text-red-400">failed</span>
                )}
              </div>
            </div>
            <pre
              ref={outputRef}
              className="p-3 bg-zinc-950 text-xs font-mono max-h-72 overflow-y-auto leading-relaxed"
            >
              {lines.map((line, i) => (
                <span
                  key={i}
                  className={
                    line.stream === 'stderr'
                      ? 'text-red-400'
                      : line.stream === 'info'
                        ? 'text-zinc-500'
                        : 'text-zinc-100'
                  }
                >
                  {line.data}
                </span>
              ))}
              {isRunning && <span className="text-zinc-500 animate-pulse">█</span>}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
