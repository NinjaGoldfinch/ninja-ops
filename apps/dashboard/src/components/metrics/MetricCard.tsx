import { type ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface MetricCardProps {
  label: string
  value: string | number | null
  unit?: string | undefined
  icon?: ReactNode | undefined
  sub?: string | undefined
}

export function MetricCard({ label, value, unit, icon, sub }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
            <div className="mt-1 flex items-baseline gap-1">
              {value !== null ? (
                <span className="font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                  {value}
                </span>
              ) : (
                <Skeleton className="h-8 w-16" />
              )}
              {unit && value !== null && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{unit}</span>
              )}
            </div>
            {sub && (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{sub}</p>
            )}
          </div>
          {icon && (
            <div className="text-zinc-400 dark:text-zinc-500 mt-0.5">{icon}</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
