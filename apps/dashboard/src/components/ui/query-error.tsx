import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from './button'
import { ApiRequestError } from '@/lib/api'

interface QueryErrorProps {
  error: unknown
  onRetry?: () => void
}

export function QueryError({ error, onRetry }: QueryErrorProps) {
  const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN_ERROR'
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred'

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <AlertCircle size={32} className="text-red-500" />
      <div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{code}</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw size={14} />
          Retry
        </Button>
      )}
    </div>
  )
}
