import { createRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { layoutRoute } from '@/layout-route'
import { useNodes } from '@/hooks/useNodes'
import { useGuests } from '@/hooks/useGuests'
import { useLiveLogs, useLogHistory } from '@/hooks/useLogs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollText, Circle } from 'lucide-react'
import type { LogEntryRow } from '@ninja/types'

export const logsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/logs',
  component: LogsPage,
})

// ─── Shared log line component ────────────────────────────────────────────────

const LEVEL_COLOR: Record<LogEntryRow['level'], string> = {
  fatal: 'text-red-600 dark:text-red-400',
  error: 'text-red-500',
  warn:  'text-amber-500',
  info:  'text-zinc-400',
  debug: 'text-zinc-500',
  trace: 'text-zinc-600',
}

function LogLineRow({ entry }: { entry: LogEntryRow }) {
  return (
    <div className="flex items-start gap-3 font-mono text-xs py-0.5 hover:bg-zinc-800/40 px-2">
      <span className="text-zinc-600 shrink-0 select-none w-28">
        {new Date(entry.ts).toLocaleTimeString()}
      </span>
      <span className={`w-12 shrink-0 ${LEVEL_COLOR[entry.level] ?? 'text-zinc-400'}`}>
        {entry.level}
      </span>
      <span className="text-zinc-500 shrink-0 w-24 truncate">
        {entry.unit ?? entry.source}
      </span>
      <span className="text-zinc-200 break-all">{entry.line}</span>
    </div>
  )
}

// ─── Filter controls ──────────────────────────────────────────────────────────

interface FilterState {
  nodeId: string
  vmid: string
  source: string
  level: string
  search: string
}

function FilterBar({
  filters,
  onFiltersChange,
}: {
  filters: FilterState
  onFiltersChange: (f: FilterState) => void
}) {
  const { data: nodes } = useNodes()
  const { data: guests } = useGuests(filters.nodeId)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1 w-36">
        <Label htmlFor="log-node">Node</Label>
        <Select
          id="log-node"
          value={filters.nodeId}
          onChange={(e) => onFiltersChange({ ...filters, nodeId: e.target.value, vmid: '' })}
        >
          <option value="">All nodes</option>
          {nodes?.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </Select>
      </div>

      <div className="space-y-1 w-36">
        <Label htmlFor="log-vmid">Container</Label>
        <Select
          id="log-vmid"
          value={filters.vmid}
          onChange={(e) => onFiltersChange({ ...filters, vmid: e.target.value })}
          disabled={!filters.nodeId}
        >
          <option value="">All</option>
          {guests?.map((g) => (
            <option key={g.vmid} value={String(g.vmid)}>{g.name} ({g.vmid})</option>
          ))}
        </Select>
      </div>

      <div className="space-y-1 w-28">
        <Label htmlFor="log-source">Source</Label>
        <Select
          id="log-source"
          value={filters.source}
          onChange={(e) => onFiltersChange({ ...filters, source: e.target.value })}
        >
          <option value="">All</option>
          <option value="app">app</option>
          <option value="agent">agent</option>
          <option value="shell">shell</option>
          <option value="system">system</option>
        </Select>
      </div>

      <div className="space-y-1 w-28">
        <Label htmlFor="log-level">Level</Label>
        <Select
          id="log-level"
          value={filters.level}
          onChange={(e) => onFiltersChange({ ...filters, level: e.target.value })}
        >
          <option value="">All</option>
          <option value="trace">trace</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
          <option value="fatal">fatal</option>
        </Select>
      </div>

      <div className="space-y-1 flex-1 min-w-40">
        <Label htmlFor="log-search">Search</Label>
        <Input
          id="log-search"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          placeholder="Filter by text…"
          className="font-mono text-sm"
        />
      </div>
    </div>
  )
}

// ─── Live tab ─────────────────────────────────────────────────────────────────

function LivePanel({ filters }: { filters: FilterState }) {
  const vmid = filters.vmid ? Number(filters.vmid) : undefined
  const allLines = useLiveLogs(vmid)

  const filtered = allLines.filter((e) => {
    if (filters.source && e.source !== filters.source) return false
    if (filters.level && e.level !== filters.level) return false
    if (filters.search && !e.line.toLowerCase().includes(filters.search.toLowerCase())) return false
    return true
  })

  if (!vmid) {
    return (
      <p className="text-sm text-zinc-500 px-2 py-4">
        Select a container above to start tailing its logs.
      </p>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-2 py-2 border-b border-zinc-800">
        <Circle size={7} className="fill-green-500 text-green-500" />
        <span className="text-xs text-zinc-400">Live — {filtered.length} lines</span>
      </div>
      <div className="max-h-[600px] overflow-y-auto py-1 bg-zinc-950 rounded-b-md">
        {filtered.length === 0 ? (
          <p className="text-xs text-zinc-600 px-2 py-2">Waiting for log lines…</p>
        ) : (
          filtered.map((entry, i) => <LogLineRow key={i} entry={entry} />)
        )}
      </div>
    </div>
  )
}

// ─── Historical tab ───────────────────────────────────────────────────────────

function HistoricalPanel({ filters }: { filters: FilterState }) {
  const [cursor, setCursor] = useState<number | undefined>()

  const queryParams = {
    ...(filters.nodeId ? { nodeId: filters.nodeId } : {}),
    ...(filters.vmid ? { vmid: Number(filters.vmid) } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    ...(cursor ? { cursor } : {}),
    limit: 200,
  }

  const { data, isLoading, isFetching } = useLogHistory(queryParams)
  const rows = data?.rows ?? []

  const hasAnyFilter = !!(filters.nodeId || filters.vmid)

  if (!hasAnyFilter) {
    return (
      <p className="text-sm text-zinc-500 px-2 py-4">
        Select a node or container to query historical logs.
      </p>
    )
  }

  return (
    <div>
      <div className="max-h-[600px] overflow-y-auto py-1 bg-zinc-950 rounded-t-md">
        {isLoading && (
          <div className="space-y-1 p-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        )}
        {!isLoading && rows.length === 0 && (
          <p className="text-xs text-zinc-600 px-2 py-2">No log entries found.</p>
        )}
        {rows.map((entry) => <LogLineRow key={entry.id} entry={entry} />)}
      </div>
      {data?.nextCursor && (
        <div className="flex justify-center py-2 border-t border-zinc-800">
          <Button
            size="sm"
            variant="outline"
            disabled={isFetching}
            onClick={() => setCursor(data.nextCursor ?? undefined)}
          >
            {isFetching ? 'Loading…' : 'Load older'}
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function LogsPage() {
  const [tab, setTab] = useState<'live' | 'historical'>('live')
  const [filters, setFilters] = useState<FilterState>({
    nodeId: '',
    vmid: '',
    source: '',
    level: '',
    search: '',
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ScrollText size={15} />
            <CardTitle>Logs</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterBar filters={filters} onFiltersChange={setFilters} />

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'live' | 'historical')}>
            <TabsList className="w-52">
              <TabsTrigger value="live">Live</TabsTrigger>
              <TabsTrigger value="historical">Historical</TabsTrigger>
            </TabsList>

            <TabsContent value="live" className="mt-3">
              <div className="rounded-md border border-zinc-800 overflow-hidden">
                <LivePanel filters={filters} />
              </div>
            </TabsContent>

            <TabsContent value="historical" className="mt-3">
              <div className="rounded-md border border-zinc-800 overflow-hidden">
                <HistoricalPanel filters={filters} />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
