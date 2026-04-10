import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { GuestRow } from './GuestRow'
import { Skeleton } from '@/components/ui/skeleton'
import { Search } from 'lucide-react'
import type { Guest } from '@ninja/types'

interface GuestTableProps {
  guests: Guest[]
  nodeId: string
  isLoading: boolean
  canPower: boolean
}

export function GuestTable({ guests, nodeId, isLoading, canPower }: GuestTableProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const filtered = guests.filter((g) => {
    if (search && !g.name.toLowerCase().includes(search.toLowerCase())) return false
    if (statusFilter && g.status !== statusFilter) return false
    if (typeFilter && g.type !== typeFilter) return false
    return true
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
          <Input
            placeholder="Filter by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-36"
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
          <option value="paused">Paused</option>
          <option value="unknown">Unknown</option>
        </Select>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-28"
        >
          <option value="">All types</option>
          <option value="lxc">LXC</option>
          <option value="qemu">QEMU</option>
        </Select>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">VMID</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Name</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Type</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Status</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">CPU</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Mem</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Uptime</th>
              <th className="px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.map((guest) => (
                  <GuestRow
                    key={guest.vmid}
                    guest={guest}
                    nodeId={nodeId}
                    canPower={canPower}
                  />
                ))}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No guests found</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
