import { createRoute } from '@tanstack/react-router'
import { useReducer, useRef, useCallback, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { layoutRoute } from '@/layout-route'
import { useNodes } from '@/hooks/useNodes'
import { useGuests } from '@/hooks/useGuests'
import { useLogs, useLogStats, useSavedFilters, useLogStream } from '@/hooks/useLogs'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown-menu'
import { ScrollText, Zap, Download, ChevronDown, ChevronUp, X } from 'lucide-react'
import type { LogEntryRow, LogQueryParams } from '@ninja/types'
import { LOG_LEVELS, LOG_SOURCES } from '@ninja/types'

export const logsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/logs',
  component: LogsPage,
})

// ── Types ─────────────────────────────────────────────────────────────────────
// Use null (not undefined) for absent optional values — exactOptionalPropertyTypes safe

type FilterState = {
  nodeId: string | null
  vmid: number | null
  levels: string[]
  sources: string[]
  units: string[]
  search: string
  searchMode: 'text' | 'regex'
  from: number | null
  to: number | null
}

type FilterAction =
  | { type: 'SET_NODE'; nodeId: string }
  | { type: 'SET_VMID'; vmid: number | null }
  | { type: 'TOGGLE_LEVEL'; level: string }
  | { type: 'TOGGLE_SOURCE'; source: string }
  | { type: 'SET_SEARCH'; search: string }
  | { type: 'TOGGLE_SEARCH_MODE' }
  | { type: 'SET_RANGE'; from: number | null; to: number | null }
  | { type: 'RESET' }
  | { type: 'LOAD'; filter: FilterState }

const INITIAL_FILTER: FilterState = {
  nodeId: null,
  vmid: null,
  levels: [],
  sources: [],
  units: [],
  search: '',
  searchMode: 'text',
  from: null,
  to: null,
}

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case 'SET_NODE':
      return { ...state, nodeId: action.nodeId || null, vmid: null }
    case 'SET_VMID':
      return { ...state, vmid: action.vmid }
    case 'TOGGLE_LEVEL':
      return {
        ...state,
        levels: state.levels.includes(action.level)
          ? state.levels.filter((l) => l !== action.level)
          : [...state.levels, action.level],
      }
    case 'TOGGLE_SOURCE':
      return {
        ...state,
        sources: state.sources.includes(action.source)
          ? state.sources.filter((s) => s !== action.source)
          : [...state.sources, action.source],
      }
    case 'SET_SEARCH':
      return { ...state, search: action.search }
    case 'TOGGLE_SEARCH_MODE':
      return { ...state, searchMode: state.searchMode === 'text' ? 'regex' : 'text' }
    case 'SET_RANGE':
      return { ...state, from: action.from, to: action.to }
    case 'RESET':
      return INITIAL_FILTER
    case 'LOAD':
      return action.filter
  }
}

function filterToQueryParams(f: FilterState): Partial<LogQueryParams> {
  const p: Partial<LogQueryParams> = { limit: 100 }
  if (f.nodeId) p.nodeId = f.nodeId
  if (f.vmid) p.vmid = f.vmid
  if (f.levels.length) p.levels = f.levels as LogQueryParams['levels']
  if (f.sources.length) p.sources = f.sources as LogQueryParams['sources']
  if (f.units.length) p.units = f.units
  if (f.search) { p.search = f.search; p.searchMode = f.searchMode }
  if (f.from) p.from = f.from
  if (f.to) p.to = f.to
  return p
}

// ── Level colors ──────────────────────────────────────────────────────────────

const LEVEL_BORDER: Record<string, string> = {
  fatal:  'border-l-purple-600',
  error:  'border-l-red-500',
  warn:   'border-l-amber-500',
  info:   'border-l-zinc-600',
  debug:  'border-l-blue-600',
  trace:  'border-l-zinc-700',
}

const LEVEL_BADGE_VARIANT: Record<string, 'destructive' | 'warning' | 'default' | 'secondary' | 'outline'> = {
  fatal:  'destructive',
  error:  'destructive',
  warn:   'warning',
  info:   'secondary',
  debug:  'default',
  trace:  'outline',
}

const LEVEL_CHART_COLOR: Record<string, string> = {
  fatal:  '#9333ea',
  error:  '#ef4444',
  warn:   '#f59e0b',
  info:   '#71717a',
  debug:  '#3b82f6',
  trace:  '#52525b',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LevelMultiSelect({ selected, onToggle }: { selected: string[]; onToggle: (l: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Level</Label>
      <div className="flex flex-wrap gap-1">
        {LOG_LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onToggle(l)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              selected.includes(l)
                ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

function SourceSelect({ selected, onToggle }: { selected: string[]; onToggle: (s: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Source</Label>
      <div className="flex flex-wrap gap-1">
        {LOG_SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onToggle(s)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              selected.includes(s)
                ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function DateRangeBar({ from, to, onChange }: {
  from: number | null
  to: number | null
  onChange: (from: number | null, to: number | null) => void
}) {
  const presets: { label: string; ms: number }[] = [
    { label: '15m', ms: 15 * 60_000 },
    { label: '1h',  ms: 60 * 60_000 },
    { label: '6h',  ms: 6 * 60 * 60_000 },
    { label: '24h', ms: 24 * 60 * 60_000 },
    { label: '7d',  ms: 7 * 24 * 60 * 60_000 },
  ]
  const now = Date.now()

  return (
    <div className="flex flex-wrap items-center gap-1">
      {presets.map((p) => {
        const active = from !== null && to === null && Math.abs(now - (from + p.ms)) < 5000
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(Date.now() - p.ms, null)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              active
                ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
            }`}
          >
            {p.label}
          </button>
        )
      })}
      {(from !== null || to !== null) && (
        <button
          type="button"
          onClick={() => onChange(null, null)}
          className="text-xs px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500 hover:border-zinc-500"
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

function StatsBar({ params, onBucketClick }: {
  params: Partial<LogQueryParams>
  onBucketClick: (from: number, to: number) => void
}) {
  const { data, isLoading } = useLogStats(params)
  const [collapsed, setCollapsed] = useState(false)

  if (isLoading || !data) return null

  const bucketMap = new Map<number, Record<string, number>>()
  for (const b of data.buckets) {
    const row = bucketMap.get(b.ts) ?? {}
    row[b.level] = (row[b.level] ?? 0) + b.count
    bucketMap.set(b.ts, row)
  }
  const chartData = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, counts]) => ({ ts, ...counts }))

  return (
    <div className="border border-zinc-800 rounded-md overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 cursor-pointer"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="text-xs text-zinc-400">
          {data.totalCount.toLocaleString()} entries
        </span>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {Object.entries(data.byLevel)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 4)
            .map(([l, n]) => (
              <span key={l}>{l}: {n.toLocaleString()}</span>
            ))}
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </div>
      </div>
      {!collapsed && chartData.length > 0 && (
        <div className="h-24 px-1 pb-1 bg-zinc-950">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              onClick={(e) => {
                const ts = e?.activePayload?.[0]?.payload?.ts as number | undefined
                if (ts !== undefined) onBucketClick(ts, ts + 3_600_000)
              }}
            >
              <XAxis
                dataKey="ts"
                tickFormatter={(v: number) => new Date(v).toLocaleTimeString()}
                tick={{ fontSize: 9, fill: '#52525b' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', fontSize: 11 }}
                labelFormatter={(v: number) => new Date(v).toLocaleString()}
              />
              {LOG_LEVELS.map((l) => (
                <Bar key={l} dataKey={l} stackId="a" fill={LEVEL_CHART_COLOR[l]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Log row (click to expand) ─────────────────────────────────────────────────

function LogRow({ entry, isExpanded, onToggle }: {
  entry: LogEntryRow
  isExpanded: boolean
  onToggle: () => void
}) {
  const borderColor = LEVEL_BORDER[entry.level] ?? 'border-l-zinc-700'
  const badgeVariant = LEVEL_BADGE_VARIANT[entry.level] ?? 'secondary'

  return (
    <div>
      <div
        className={`border-l-2 ${borderColor} flex items-start gap-2 font-mono text-xs py-0.5 px-2 hover:bg-zinc-800/40 cursor-pointer ${isExpanded ? 'bg-zinc-800/60' : ''}`}
        onClick={onToggle}
      >
        <span className="text-zinc-600 shrink-0 w-36 select-none whitespace-nowrap">
          {new Date(entry.ts).toLocaleString(undefined, {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          })}
        </span>
        <span className="text-zinc-600 shrink-0 w-10">{entry.vmid}</span>
        <span className="text-zinc-500 shrink-0 w-16 truncate">{entry.source}</span>
        {entry.unit !== null && (
          <span className="text-zinc-600 shrink-0 w-20 truncate">{entry.unit}</span>
        )}
        <Badge variant={badgeVariant} className="shrink-0">{entry.level}</Badge>
        <span className="text-zinc-200 break-all">{entry.line}</span>
      </div>
      {isExpanded && (
        <div className="bg-zinc-900 border-l-2 border-zinc-700 mx-2 mb-1 p-2 rounded-r text-xs font-mono">
          <pre className="whitespace-pre-wrap text-zinc-300 break-all">
            {JSON.stringify({
              id: entry.id, ts: entry.ts, vmid: entry.vmid,
              nodeId: entry.nodeId, source: entry.source, unit: entry.unit,
              level: entry.level, line: entry.line,
            }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Virtualized log table ─────────────────────────────────────────────────────

function LogTable({ rows, onLoadMore, hasMore, isLoading }: {
  rows: LogEntryRow[]
  onLoadMore: (() => void) | null
  hasMore: boolean
  isLoading: boolean
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 20,
  })

  const items = virtualizer.getVirtualItems()

  const onScroll = useCallback(() => {
    if (!parentRef.current || !onLoadMore || !hasMore || isLoading) return
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current
    if (scrollHeight - scrollTop - clientHeight < 200) {
      onLoadMore()
    }
  }, [onLoadMore, hasMore, isLoading])

  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [onScroll])

  if (rows.length === 0 && !isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-zinc-600">
        No log entries found.
      </div>
    )
  }

  return (
    <div ref={parentRef} className="h-[520px] overflow-y-auto bg-zinc-950">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {items.map((item) => {
          const entry = rows[item.index]
          if (!entry) return null
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: item.start,
                left: 0,
                right: 0,
              }}
            >
              <LogRow
                entry={entry}
                isExpanded={expandedId === entry.id}
                onToggle={() => setExpandedId((prev) => prev === entry.id ? null : entry.id)}
              />
            </div>
          )
        })}
      </div>
      {isLoading && (
        <div className="flex justify-center py-2">
          <span className="text-xs text-zinc-600">Loading…</span>
        </div>
      )}
    </div>
  )
}

// ── Export modal ──────────────────────────────────────────────────────────────

function ExportModal({ open, onClose, params, totalCount }: {
  open: boolean
  onClose: () => void
  params: Partial<LogQueryParams>
  totalCount: number
}) {
  const [format, setFormat] = useState<'ndjson' | 'csv'>('ndjson')
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      await api.logs.export({ ...params, format })
    } finally {
      setExporting(false)
      onClose()
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Export Logs">
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          {totalCount.toLocaleString()} entries match the current filter.
        </p>
        <div className="flex gap-2">
          {(['ndjson', 'csv'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`text-sm px-3 py-1.5 rounded border transition-colors ${
                format === f
                  ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={() => { void handleExport() }} disabled={exporting || totalCount > 50_000}>
          {exporting ? 'Exporting…' : 'Download'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

// ── Save filter modal ─────────────────────────────────────────────────────────

function SaveFilterModal({ open, onClose, filter }: {
  open: boolean
  onClose: () => void
  filter: Partial<LogQueryParams>
}) {
  const [name, setName] = useState('')
  const { create } = useSavedFilters()

  const handleSave = () => {
    if (!name.trim()) return
    create.mutate({ name: name.trim(), filter }, { onSuccess: onClose })
  }

  return (
    <Dialog open={open} onClose={onClose} title="Save Filter">
      <div className="space-y-3">
        <Label htmlFor="filter-name">Name</Label>
        <Input
          id="filter-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Errors last hour"
          autoFocus
        />
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!name.trim() || create.isPending}>
          {create.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function LogsPage() {
  const [filter, dispatch] = useReducer(filterReducer, INITIAL_FILTER)
  const [isLive, setIsLive] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showSaveFilter, setShowSaveFilter] = useState(false)

  const { data: nodes } = useNodes()
  const { data: guests } = useGuests(filter.nodeId ?? '')
  const { list: savedFiltersList, remove: removeFilter } = useSavedFilters()

  const queryParams = filterToQueryParams(filter)

  const { data: histPages, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching } = useLogs(queryParams)
  const histRows = histPages?.pages.flatMap((p) => p.rows) ?? []

  const { lines: liveLines, start: startLive, stop: stopLive } = useLogStream(queryParams)

  const statsParams: Partial<LogQueryParams> = {}
  if (queryParams.vmid) statsParams.vmid = queryParams.vmid
  if (queryParams.nodeId) statsParams.nodeId = queryParams.nodeId
  if (queryParams.levels) statsParams.levels = queryParams.levels
  if (queryParams.from) statsParams.from = queryParams.from
  if (queryParams.to) statsParams.to = queryParams.to

  const toggleLive = () => {
    if (isLive) { stopLive(); setIsLive(false) }
    else { startLive(); setIsLive(true) }
  }

  const displayRows = isLive ? liveLines : histRows

  const savedFilters = savedFiltersList.data ?? []

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ScrollText size={15} />
              <CardTitle>Logs</CardTitle>
            </div>

            <div className="flex items-center gap-2">
              <DropdownMenu
                align="right"
                trigger={
                  <Button variant="outline" size="sm" className="gap-1">
                    Saved filters <ChevronDown size={12} />
                  </Button>
                }
              >
                {savedFilters.length === 0 && (
                  <DropdownItem disabled>No saved filters</DropdownItem>
                )}
                {savedFilters.map((f) => (
                  <div key={f.id} className="flex items-center justify-between px-1">
                    <DropdownItem
                      onClick={() => dispatch({
                        type: 'LOAD',
                        filter: {
                          levels: (f.filter.levels ?? []) as string[],
                          sources: (f.filter.sources ?? []) as string[],
                          units: f.filter.units ?? [],
                          search: f.filter.search ?? '',
                          searchMode: f.filter.searchMode ?? 'text',
                          nodeId: f.filter.nodeId ?? null,
                          vmid: f.filter.vmid ?? null,
                          from: f.filter.from ?? null,
                          to: f.filter.to ?? null,
                        },
                      })}
                    >
                      {f.name}
                    </DropdownItem>
                    <button
                      type="button"
                      onClick={() => removeFilter.mutate(f.id)}
                      className="text-zinc-600 hover:text-red-400 px-2"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <DropdownSeparator />
                <DropdownItem onClick={() => setShowSaveFilter(true)}>
                  Save current filter…
                </DropdownItem>
              </DropdownMenu>

              <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowExport(true)}>
                <Download size={12} /> Export
              </Button>

              <Button
                variant={isLive ? 'default' : 'outline'}
                size="sm"
                className="gap-1"
                onClick={toggleLive}
              >
                <Zap size={12} /> Live
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Filter panel */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="flex gap-2">
              <div className="space-y-1 flex-1">
                <Label className="text-xs" htmlFor="log-node">Node</Label>
                <select
                  id="log-node"
                  className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200"
                  value={filter.nodeId ?? ''}
                  onChange={(e) => dispatch({ type: 'SET_NODE', nodeId: e.target.value })}
                >
                  <option value="">All nodes</option>
                  {nodes?.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 flex-1">
                <Label className="text-xs" htmlFor="log-vm">Container</Label>
                <select
                  id="log-vm"
                  className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200"
                  value={filter.vmid ?? ''}
                  onChange={(e) =>
                    dispatch({ type: 'SET_VMID', vmid: e.target.value ? Number(e.target.value) : null })
                  }
                  disabled={!filter.nodeId}
                >
                  <option value="">All</option>
                  {guests?.map((g) => (
                    <option key={g.vmid} value={g.vmid}>{g.name} ({g.vmid})</option>
                  ))}
                </select>
              </div>
            </div>

            <LevelMultiSelect
              selected={filter.levels}
              onToggle={(l) => dispatch({ type: 'TOGGLE_LEVEL', level: l })}
            />

            <SourceSelect
              selected={filter.sources}
              onToggle={(s) => dispatch({ type: 'TOGGLE_SOURCE', source: s })}
            />

            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs" htmlFor="log-search">Search</Label>
              <div className="flex gap-1">
                <Input
                  id="log-search"
                  value={filter.search}
                  onChange={(e) => dispatch({ type: 'SET_SEARCH', search: e.target.value })}
                  placeholder={filter.searchMode === 'regex' ? '/pattern/…' : 'Filter by text…'}
                  className="font-mono text-xs flex-1"
                />
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'TOGGLE_SEARCH_MODE' })}
                  className={`px-2 rounded border text-xs transition-colors ${
                    filter.searchMode === 'regex'
                      ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                      : 'border-zinc-700 text-zinc-500'
                  }`}
                >
                  .*
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Time range</Label>
              <DateRangeBar
                from={filter.from}
                to={filter.to}
                onChange={(from, to) => dispatch({ type: 'SET_RANGE', from, to })}
              />
            </div>
          </div>

          {/* Stats histogram */}
          <StatsBar
            params={statsParams}
            onBucketClick={(from, to) => dispatch({ type: 'SET_RANGE', from, to })}
          />

          {/* Log table */}
          <div className="rounded-md border border-zinc-800 overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1 bg-zinc-900 border-b border-zinc-800 font-mono text-xs text-zinc-600">
              <span className="w-36">timestamp</span>
              <span className="w-10">vmid</span>
              <span className="w-16">source</span>
              <span className="w-20">unit</span>
              <span className="w-12">level</span>
              <span>message</span>
            </div>

            <LogTable
              rows={displayRows}
              onLoadMore={!isLive ? () => { void fetchNextPage() } : null}
              hasMore={!isLive && (hasNextPage ?? false)}
              isLoading={isFetching || isFetchingNextPage}
            />
          </div>
        </CardContent>
      </Card>

      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        params={queryParams}
        totalCount={0}
      />

      <SaveFilterModal
        open={showSaveFilter}
        onClose={() => setShowSaveFilter(false)}
        filter={queryParams}
      />
    </div>
  )
}
