import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { formatTimestamp, formatBytes } from '@/lib/utils'
import type { GuestMetrics } from '@ninja/types'

interface NetworkChartProps {
  history: GuestMetrics[]
}

export function NetworkChart({ history }: NetworkChartProps) {
  const data = history.map((m) => ({
    time: formatTimestamp(m.timestamp),
    in: m.netin,
    out: m.netout,
  }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="netInGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="netOutGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
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
          formatter={(v: number, name: string) => [formatBytes(v), name === 'in' ? 'In' : 'Out']}
        />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Area
          type="monotone"
          dataKey="in"
          stroke="#22c55e"
          strokeWidth={2}
          fill="url(#netInGrad)"
          dot={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="out"
          stroke="#f59e0b"
          strokeWidth={2}
          fill="url(#netOutGrad)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
