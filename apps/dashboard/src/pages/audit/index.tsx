import { createRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { layoutRoute } from '@/layout-route'
import { useAuditLog } from '@/hooks/useAudit'
import { useAuthStore } from '@/stores/auth'
import { AuditTable } from '@/components/audit/AuditTable'
import { QueryError } from '@/components/ui/query-error'
import { Button } from '@/components/ui/button'
import { Lock, ChevronLeft, ChevronRight } from 'lucide-react'

export const auditRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/audit',
  component: AuditPage,
})

const PAGE_SIZE = 20

function AuditPage() {
  const { user } = useAuthStore()
  const [page, setPage] = useState(1)
  const { data, isLoading, error, refetch } = useAuditLog(page, PAGE_SIZE)

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Lock size={32} className="text-zinc-400" />
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Access denied</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Audit log is restricted to admins.</p>
      </div>
    )
  }

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {data?.total ?? '—'} total entries
      </p>

      <AuditTable entries={data?.items ?? []} isLoading={isLoading} />

      {/* Pagination */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft size={14} />
          Previous
        </Button>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  )
}
