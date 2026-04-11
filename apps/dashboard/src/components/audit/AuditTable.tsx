import { Skeleton } from '@/components/ui/skeleton'
import { formatDatetime } from '@/lib/utils'
import type { AuditLogEntry, AuditAction } from '@ninja/types'

const ACTION_LABELS: Record<AuditAction, string> = {
  login: 'Logged in',
  logout: 'Logged out',
  password_change: 'Changed password',
  node_create: 'Created node',
  node_update: 'Updated node',
  node_delete: 'Deleted node',
  guest_power: 'Power action on guest',
  snapshot_create: 'Created snapshot',
  snapshot_rollback: 'Rolled back snapshot',
  snapshot_delete: 'Deleted snapshot',
  deploy_trigger: 'Triggered deploy',
  deploy_cancel: 'Cancelled deploy',
  target_create: 'Created deploy target',
  target_update: 'Updated deploy target',
  target_delete: 'Deleted deploy target',
  command_run: 'Ran command',
  command_create: 'Created command',
  command_delete: 'Deleted command',
  provision_lxc: 'Provisioned LXC container',
  provision_qemu: 'Provisioned QEMU VM',
  provision_delete: 'Deleted provisioning job',
  agent_deploy: 'Deployed agent',
  guest_delete: 'Deleted guest',
}

interface AuditTableProps {
  entries: AuditLogEntry[]
  isLoading: boolean
}

export function AuditTable({ entries, isLoading }: AuditTableProps) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
          <tr>
            <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Time</th>
            <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">User</th>
            <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Action</th>
            <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Resource</th>
            <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">IP</th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            : entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    {formatDatetime(entry.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-sm font-mono text-zinc-700 dark:text-zinc-300">
                    {entry.username ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-zinc-500 dark:text-zinc-400">
                    {entry.resourceType && (
                      <span className="capitalize">{entry.resourceType}</span>
                    )}
                    {entry.resourceId && (
                      <span className="ml-1 opacity-60">{entry.resourceId.slice(0, 8)}</span>
                    )}
                    {!entry.resourceType && '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-400 dark:text-zinc-500">
                    {entry.ip ?? '—'}
                  </td>
                </tr>
              ))}
          {!isLoading && entries.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No audit entries</p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
