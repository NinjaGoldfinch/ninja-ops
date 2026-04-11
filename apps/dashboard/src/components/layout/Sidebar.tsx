import { Link } from '@tanstack/react-router'
import {
  LayoutDashboard,
  Server,
  Bot,
  ClipboardList,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  Layers,
  Stethoscope,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'

const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/nodes', label: 'Nodes', icon: Server },
  { to: '/containers', label: 'Containers', icon: Layers },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/audit', label: 'Audit', icon: ClipboardList },
  { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUiStore()

  return (
    <aside
      className={cn(
        'relative flex flex-col h-full border-r border-zinc-200 dark:border-zinc-800',
        'bg-white dark:bg-zinc-950 transition-all duration-200',
        sidebarCollapsed ? 'w-14' : 'w-60',
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center gap-2.5 h-14 px-4 border-b border-zinc-200 dark:border-zinc-800',
        sidebarCollapsed && 'justify-center px-0',
      )}>
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 shrink-0">
          <Zap size={14} className="text-white" />
        </div>
        {!sidebarCollapsed && (
          <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
            ninja-ops
          </span>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              'text-zinc-600 dark:text-zinc-400',
              'hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100',
              sidebarCollapsed && 'justify-center px-0 w-10 mx-auto',
            )}
            activeProps={{
              className: 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50',
            }}
          >
            <Icon size={16} className="shrink-0" />
            {!sidebarCollapsed && <span>{label}</span>}
          </Link>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className={cn(
          'flex items-center justify-center h-8 w-8 rounded-full',
          'absolute -right-4 top-1/2 -translate-y-1/2',
          'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700',
          'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
          'shadow-sm transition-colors',
        )}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  )
}
