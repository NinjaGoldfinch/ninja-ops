import { Sun, Moon, Monitor, LogOut, User } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { DropdownMenu, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ws } from '@/lib/ws'
import { useRouter } from '@tanstack/react-router'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const { user, logout } = useAuthStore()
  const { theme, setTheme } = useUiStore()
  const router = useRouter()

  function handleLogout() {
    ws.disconnect()
    logout()
    void router.navigate({ to: '/login' })
  }

  const themeIcons = {
    light: <Sun size={16} />,
    dark: <Moon size={16} />,
    system: <Monitor size={16} />,
  }

  return (
    <header className="flex items-center justify-between h-14 px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
      <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h1>

      <div className="flex items-center gap-2">
        {/* Theme cycle toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
            setTheme(next)
          }}
          aria-label="Toggle theme"
        >
          {themeIcons[theme]}
        </Button>

        {/* User menu */}
        <DropdownMenu
          align="right"
          trigger={
            <Button variant="ghost" size="sm" className="gap-2">
              <User size={14} />
              <span className="font-mono text-xs">{user?.username ?? '—'}</span>
            </Button>
          }
        >
          <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="font-medium text-zinc-900 dark:text-zinc-100">{user?.username}</div>
            <div className="capitalize mt-0.5">{user?.role}</div>
          </div>
          <DropdownSeparator />
          <DropdownItem onClick={handleLogout} variant="destructive">
            <LogOut size={14} />
            Sign out
          </DropdownItem>
        </DropdownMenu>
      </div>
    </header>
  )
}
