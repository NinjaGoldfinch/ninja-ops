import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatTimestamp, formatBytes } from '@/lib/utils'
import type { GuestMetrics } from '@ninja/types'

interface MemoryChartProps {
  history: GuestMetrics[]
}

export function MemoryChart({ history }: MemoryChartProps) {
  const data = history.map((m) => ({
    time: formatTimestamp(m.timestamp),
    used: m.mem,
    total: m.maxmem,
  }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="opacity-10" />
        <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatBytes(v, 0)}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
          formatter={(v: number) => [formatBytes(v), 'Memory']}
        />
        <Area
          type="monotone"
          dataKey="used"
          stroke="#8b5cf6"
          strokeWidth={2}
          fill="url(#memGrad)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
