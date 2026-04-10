import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { useGuestMetrics } from '@/hooks/useMetrics'

interface GuestMetricsSparklineProps {
  nodeId: string
  vmid: number
}

const DISPLAY_POINTS = 20

export function GuestMetricsSparkline({ nodeId, vmid }: GuestMetricsSparklineProps) {
  const { history } = useGuestMetrics(nodeId, vmid)
  const data = history.slice(-DISPLAY_POINTS).map((m) => ({ cpu: Math.round(m.cpu * 100) }))

  const latest = data[data.length - 1]?.cpu ?? 0
  const color = latest < 70 ? '#22c55e' : latest < 90 ? '#f59e0b' : '#ef4444'

  if (data.length === 0) {
    return <div className="h-12 w-full bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
  }

  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={`sparkGrad-${vmid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="cpu"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#sparkGrad-${vmid})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
